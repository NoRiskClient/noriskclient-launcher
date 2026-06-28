pub mod fabric_installer;
pub mod forge_installer;
pub mod neoforge_installer;
pub mod quilt_installer;

use crate::config::ProjectDirsExt;
use crate::error::Result;
use crate::minecraft::api::fabric_api::FabricApi;
use crate::minecraft::api::forge_api::ForgeApi;
use crate::minecraft::api::neo_forge_api::NeoForgeApi;
use crate::minecraft::api::quilt_api::QuiltApi;
use crate::state::profile_state::{ModLoader, Profile};
use crate::integrations::norisk_packs::NoriskModpacksConfig;
use async_trait::async_trait;
use fabric_installer::FabricInstaller;
use forge_installer::ForgeInstaller;
use log::warn;
use neoforge_installer::NeoForgeInstaller;
use quilt_installer::QuiltInstaller;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedLoaderVersion {
    pub version: Option<String>,
    pub reason: LoaderVersionReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoaderVersionReason {
    ProfileDefault,
    NoriskPack,
    UserOverwrite,
    NotResolved,
}

pub struct ModloaderFactory;

impl ModloaderFactory {
    /// Resolves the loader version to use for a profile, considering Norisk pack policies and user overrides
    pub async fn resolve_loader_version(
        profile: &Profile,
        minecraft_version: &str,
        norisk_pack_config: Option<&NoriskModpacksConfig>,
    ) -> ResolvedLoaderVersion {
        if profile.loader == ModLoader::Vanilla {
            return ResolvedLoaderVersion {
                version: None,
                reason: LoaderVersionReason::ProfileDefault,
            };
        }

        // 1. Check for user overwrite first (highest priority).
        //
        // New per-loader map takes precedence over the legacy single-slot
        // `overwrite_loader_version`. The legacy fallback is only consulted
        // when the map is entirely empty — a "virgin" old profile that no
        // new-code write has touched. Once any entry lands in the map, the
        // legacy field is treated as stale (it may have been written for a
        // different loader and we can't know which).
        if profile.settings.use_overwrite_loader_version {
            let loader_key = profile.loader.as_str();
            if let Some(v) = profile.settings.overwrite_loader_versions.get(loader_key) {
                if !v.is_empty() {
                    return ResolvedLoaderVersion {
                        version: Some(v.clone()),
                        reason: LoaderVersionReason::UserOverwrite,
                    };
                }
            } else if profile.settings.overwrite_loader_versions.is_empty() {
                if let Some(v) = &profile.settings.overwrite_loader_version {
                    if !v.is_empty() {
                        return ResolvedLoaderVersion {
                            version: Some(v.clone()),
                            reason: LoaderVersionReason::UserOverwrite,
                        };
                    }
                }
            }
        }

        // 2. Check for Norisk pack policy (honors rollout alias)
        if let Some(selected_pack_id) = profile.effective_norisk_pack_id().await {
            if let Some(config) = norisk_pack_config {
                if let Ok(resolved_pack) = config.get_resolved_pack_definition(&selected_pack_id) {
                    if let Some(policy) = &resolved_pack.loader_policy {
                        let loader_key = profile.loader.as_str();
                        let mut resolved_version: Option<String> = None;
                        
                        // Helper to read version from a loader map
                        let get_ver = |m: &std::collections::HashMap<String, crate::integrations::norisk_packs::LoaderSpec>| {
                            m.get(loader_key).and_then(|s| s.version.clone())
                        };
                        
                        // 1) Exact MC version match
                        if let Some(loader_map) = policy.by_minecraft.get(minecraft_version) {
                            resolved_version = get_ver(loader_map);
                        }
                        
                        // 2) Wildcard pattern like "1.21.*"
                        if resolved_version.is_none() {
                            for (pat, loader_map) in &policy.by_minecraft {
                                if pat.ends_with(".*") {
                                    let prefix = &pat[..pat.len() - 2];
                                    if minecraft_version.starts_with(prefix) {
                                        resolved_version = get_ver(loader_map);
                                        if resolved_version.is_some() { break; }
                                    }
                                }
                            }
                        }
                        
                        // 3) Prefix match (e.g., "1.21")
                        if resolved_version.is_none() {
                            for (pat, loader_map) in &policy.by_minecraft {
                                if !pat.ends_with(".*") && minecraft_version.starts_with(pat) {
                                    resolved_version = get_ver(loader_map);
                                    if resolved_version.is_some() { break; }
                                }
                            }
                        }
                        
                        // 4) Default fallback
                        if resolved_version.is_none() {
                            resolved_version = policy
                                .default
                                .get(loader_key)
                                .and_then(|s| s.version.clone());
                        }

                        if let Some(version) = resolved_version {
                            return ResolvedLoaderVersion {
                                version: Some(version),
                                reason: LoaderVersionReason::NoriskPack,
                            };
                        }
                    }
                }
            }
        }

        // 3. Fall back to profile's default loader version
        if let Some(profile_version) = &profile.loader_version {
            if !profile_version.is_empty() {
                return ResolvedLoaderVersion {
                    version: Some(profile_version.clone()),
                    reason: LoaderVersionReason::ProfileDefault,
                };
            }
        }

        // 4. Auto-resolve from the loader's own API — fetch the latest
        // available version so the frontend always has a concrete string
        // to show instead of a useless "latest" placeholder. Reason stays
        // ProfileDefault because this is "what the system picked for you"
        // with no explicit override involved. Network failures fall through
        // to NotResolved.
        if let Some(auto) = Self::fetch_latest_from_api(&profile.loader, minecraft_version).await {
            return ResolvedLoaderVersion {
                version: Some(auto),
                reason: LoaderVersionReason::ProfileDefault,
            };
        }

        // 5. No version resolved (API unavailable, unsupported loader, …)
        ResolvedLoaderVersion {
            version: None,
            reason: LoaderVersionReason::NotResolved,
        }
    }

    /// Calls the live loader metadata API for `loader` + `mc_version` and
    /// returns the top (newest) entry formatted like the rest of the launcher
    /// stores it. For Fabric/Quilt that means appending " (stable)" when the
    /// loader flags it — matches the wizard's `"{ver} (stable)"` encoding
    /// (see `ModLoaderStep.tsx:194`) so saved + resolved values compare
    /// cleanly. Errors are swallowed with a warn-level log so the UI stays
    /// responsive.
    async fn fetch_latest_from_api(
        loader: &ModLoader,
        mc_version: &str,
    ) -> Option<String> {
        match loader {
            ModLoader::Fabric => match FabricApi::new().get_loader_versions(mc_version).await {
                Ok(list) => list.first().map(|v| {
                    if v.loader.stable {
                        format!("{} (stable)", v.loader.version)
                    } else {
                        v.loader.version.clone()
                    }
                }),
                Err(e) => {
                    warn!("Auto-resolve fabric: {}", e);
                    None
                }
            },
            ModLoader::Quilt => match QuiltApi::new().get_loader_versions(mc_version).await {
                Ok(list) => list.first().map(|v| {
                    if v.loader.stable {
                        format!("{} (stable)", v.loader.version)
                    } else {
                        v.loader.version.clone()
                    }
                }),
                Err(e) => {
                    warn!("Auto-resolve quilt: {}", e);
                    None
                }
            },
            ModLoader::Forge => match ForgeApi::new().get_all_versions().await {
                Ok(meta) => meta
                    .get_versions_for_minecraft(mc_version)
                    .first()
                    .cloned(),
                Err(e) => {
                    warn!("Auto-resolve forge: {}", e);
                    None
                }
            },
            ModLoader::NeoForge => match NeoForgeApi::new().get_all_versions().await {
                Ok(meta) => meta
                    .get_versions_for_minecraft(mc_version)
                    .first()
                    .cloned(),
                Err(e) => {
                    warn!("Auto-resolve neoforge: {}", e);
                    None
                }
            },
            ModLoader::Vanilla => None,
        }
    }

    pub fn create_installer(
        modloader: &ModLoader,
        java_path: PathBuf,
    ) -> Box<dyn ModloaderInstaller> {
        match modloader {
            ModLoader::Fabric => Box::new(FabricInstaller::new()),
            ModLoader::Quilt => Box::new(QuiltInstaller::new()),
            ModLoader::Forge => Box::new(ForgeInstaller::new(java_path)),
            ModLoader::NeoForge => Box::new(NeoForgeInstaller::new(java_path)),
            ModLoader::Vanilla => Box::new(VanillaInstaller),
        }
    }

    pub fn create_installer_with_config(
        modloader: &ModLoader,
        java_path: PathBuf,
        concurrent_downloads: usize,
    ) -> Box<dyn ModloaderInstaller> {
        match modloader {
            ModLoader::Fabric => {
                let mut installer = FabricInstaller::new();
                installer.set_concurrent_downloads(concurrent_downloads);
                Box::new(installer)
            }
            ModLoader::Quilt => {
                let mut installer = QuiltInstaller::new();
                installer.set_concurrent_downloads(concurrent_downloads);
                Box::new(installer)
            }
            ModLoader::Forge => {
                let mut installer = ForgeInstaller::new(java_path);
                installer.set_concurrent_downloads(concurrent_downloads);
                Box::new(installer)
            }
            ModLoader::NeoForge => {
                let mut installer = NeoForgeInstaller::new(java_path);
                installer.set_concurrent_downloads(concurrent_downloads);
                Box::new(installer)
            }
            ModLoader::Vanilla => Box::new(VanillaInstaller),
        }
    }
}

#[async_trait]
pub trait ModloaderInstaller: Send {
    async fn install(&self, version_id: &str, profile: &Profile) -> Result<ModloaderInstallResult>;
}

#[async_trait]
impl ModloaderInstaller for FabricInstaller {
    async fn install(&self, version_id: &str, profile: &Profile) -> Result<ModloaderInstallResult> {
        let libraries = self.install(version_id, profile).await?;
        // Get the latest fabric version to set the main class
        let fabric_api = crate::minecraft::api::fabric_api::FabricApi::new();
        let fabric_version = match &profile.loader_version {
            Some(version_str) if !version_str.is_empty() => {
                let target_version = version_str.trim_end_matches(" (stable)").trim();
                let all_versions = fabric_api.get_loader_versions(version_id).await?;
                match all_versions
                    .into_iter()
                    .find(|v| v.loader.version == target_version)
                {
                    Some(found) => found,
                    None => fabric_api.get_latest_stable_version(version_id).await?,
                }
            }
            _ => fabric_api.get_latest_stable_version(version_id).await?,
        };

        Ok(ModloaderInstallResult {
            libraries,
            main_class: Some(self.get_main_class(&fabric_version)),
            jvm_args: None,
            game_args: None,
            minecraft_arguments: None,
            custom_client_path: None,
            force_include_minecraft_jar: false,
        })
    }
}

#[async_trait]
impl ModloaderInstaller for QuiltInstaller {
    async fn install(&self, version_id: &str, profile: &Profile) -> Result<ModloaderInstallResult> {
        let libraries = self.install(version_id, profile).await?;
        // Get the latest quilt version to set the main class
        let quilt_api = crate::minecraft::api::quilt_api::QuiltApi::new();
        let quilt_version = match &profile.loader_version {
            Some(version_str) if !version_str.is_empty() => {
                let target_version = version_str.trim_end_matches(" (stable)").trim();
                let all_versions = quilt_api.get_loader_versions(version_id).await?;
                match all_versions
                    .into_iter()
                    .find(|v| v.loader.version == target_version)
                {
                    Some(found) => found,
                    None => quilt_api.get_latest_stable_version(version_id).await?,
                }
            }
            _ => quilt_api.get_latest_stable_version(version_id).await?,
        };

        Ok(ModloaderInstallResult {
            libraries,
            main_class: Some(self.get_main_class(&quilt_version)),
            jvm_args: None,
            game_args: None,
            minecraft_arguments: None,
            custom_client_path: None,
            force_include_minecraft_jar: false,
        })
    }
}

#[async_trait]
impl ModloaderInstaller for ForgeInstaller {
    async fn install(&self, version_id: &str, profile: &Profile) -> Result<ModloaderInstallResult> {
        let result = self.install(version_id, profile).await?;

        Ok(ModloaderInstallResult {
            libraries: result.libraries,
            main_class: Some(result.main_class),
            jvm_args: Some(result.jvm_args),
            game_args: Some(result.game_args),
            minecraft_arguments: result.minecraft_arguments,
            custom_client_path: result.custom_client_path,
            force_include_minecraft_jar: result.force_include_minecraft_jar,
        })
    }
}

#[async_trait]
impl ModloaderInstaller for NeoForgeInstaller {
    async fn install(&self, version_id: &str, profile: &Profile) -> Result<ModloaderInstallResult> {
        let result = self.install(version_id, profile).await?;

        let mut alt_jvm_args = None;
        if result.uses_neoforgeclient {
            // For NeoForge with the special launcher case
            let neoforge_api = crate::minecraft::api::neo_forge_api::NeoForgeApi::new();
            let versions = neoforge_api.get_all_versions().await?;
            let compatible_versions = versions.get_versions_for_minecraft(version_id);

            let target_version_str = match &profile.loader_version {
                Some(v) if !v.is_empty() && compatible_versions.contains(v) => v.clone(),
                _ => compatible_versions
                    .first()
                    .cloned()
                    .unwrap_or_else(|| version_id.to_string()),
            };

            // Special case for neoforgeclient flag - additional JVM args needed
            use crate::minecraft::downloads::neo_forge_installer_download::NeoForgeInstallerDownloadService;
            use crate::minecraft::launch::neo_forge_arguments::NeoForgeArguments;

            // Download the NeoForge version JSON to get the proper version object
            let downloader = NeoForgeInstallerDownloadService::new();
            let neoforge_version = downloader.extract_version_json(&target_version_str).await?;

            alt_jvm_args = Some(NeoForgeArguments::get_jvm_arguments(
                &neoforge_version,
                &crate::config::LAUNCHER_DIRECTORY
                    .meta_dir()
                    .join("libraries"),
                version_id, // MCVERSION not NEOFORGEVERSION
            ));
        }

        Ok(ModloaderInstallResult {
            libraries: result.libraries,
            main_class: Some(result.main_class),
            jvm_args: alt_jvm_args.or(Some(result.jvm_args)),
            game_args: Some(result.game_args),
            minecraft_arguments: result.minecraft_arguments,
            custom_client_path: if result.uses_neoforgeclient {
                None
            } else {
                result.custom_client_path
            },
            force_include_minecraft_jar: false,
        })
    }
}

struct VanillaInstaller;

#[async_trait]
impl ModloaderInstaller for VanillaInstaller {
    async fn install(
        &self,
        _version_id: &str,
        _profile: &Profile,
    ) -> Result<ModloaderInstallResult> {
        // Nothing to install for vanilla
        Ok(ModloaderInstallResult {
            libraries: Vec::new(),
            main_class: None, // Will use the vanilla main class from the version JSON
            jvm_args: None,
            game_args: None,
            minecraft_arguments: None,
            custom_client_path: None,
            force_include_minecraft_jar: false,
        })
    }
}

pub struct ModloaderInstallResult {
    pub libraries: Vec<PathBuf>,
    pub main_class: Option<String>,
    pub jvm_args: Option<Vec<String>>,
    pub game_args: Option<Vec<String>>,
    pub minecraft_arguments: Option<String>,
    pub custom_client_path: Option<PathBuf>,
    pub force_include_minecraft_jar: bool,
}
