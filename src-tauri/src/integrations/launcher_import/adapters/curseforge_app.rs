use super::super::adapter::{first_existing, LauncherAdapter};
use super::super::loader_map;
use super::super::model::*;
use crate::error::{AppError, Result};
use crate::utils::import_safety::check_content_file_name;
use async_trait::async_trait;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const MARKERS: &[&str] = &["minecraftinstance.json"];
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MinecraftInstance {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    game_version: Option<String>,
    #[serde(default)]
    base_mod_loader: Option<BaseModLoader>,
    #[serde(default)]
    profile_image_path: Option<String>,
    #[serde(default)]
    installed_modpack: Option<InstalledModpack>,
    #[serde(default)]
    installed_addons: Vec<InstalledAddon>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BaseModLoader {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    minecraft_version: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledModpack {
    #[serde(default, alias = "addonID")]
    addon_id: Option<u32>,
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    installed_file: Option<InstalledFile>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledAddon {
    #[serde(default, alias = "addonID")]
    addon_id: Option<u32>,
    #[serde(default)]
    installed_file: Option<InstalledFile>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledFile {
    #[serde(default)]
    id: Option<u32>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    file_fingerprint: Option<u64>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    hashes: Vec<FileHash>,
    #[serde(default)]
    game_versions: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FileHash {
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    algo: Option<u32>,
}

pub struct CurseForgeAppAdapter;

impl MinecraftInstance {
    async fn read(dir: &Path) -> Result<Self> {
        let path = dir.join("minecraftinstance.json");
        let metadata = tokio::fs::metadata(&path).await.map_err(AppError::Io)?;
        if metadata.len() > MAX_MANIFEST_BYTES {
            return Err(AppError::Other(format!(
                "'{}' is too large to be an instance manifest",
                path.display()
            )));
        }

        let raw = tokio::fs::read(&path).await.map_err(AppError::Io)?;
        serde_json::from_slice(&raw).map_err(AppError::Json)
    }

    fn loader_pick(&self) -> loader_map::LoaderPick {
        self.base_mod_loader
            .as_ref()
            .and_then(|loader| loader.name.as_deref())
            .map(loader_map::loader_from_curseforge_name)
            .unwrap_or_else(loader_map::LoaderPick::vanilla)
    }

    async fn icon(&self, root: &Path, dir: &Path) -> Option<IconRef> {
        if let Some(declared) = self
            .profile_image_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let candidate = PathBuf::from(declared);
            if candidate.starts_with(root) || candidate.starts_with(dir) {
                if let Some(found) = first_existing([candidate]).await {
                    return Some(IconRef::File(found));
                }
            }
        }

        self.installed_modpack
            .as_ref()
            .and_then(|pack| pack.thumbnail_url.as_deref())
            .filter(|url| url.starts_with("https://"))
            .map(|url| IconRef::Url(url.to_string()))
    }

    fn declared_mods(&self) -> Vec<DeclaredMod> {
        let mut mods = Vec::new();

        for addon in &self.installed_addons {
            let (Some(project_id), Some(file)) = (addon.addon_id, addon.installed_file.as_ref())
            else {
                continue;
            };
            let (Some(file_id), Some(raw_name)) = (file.id, file.file_name.as_deref()) else {
                continue;
            };

            let enabled = !raw_name.ends_with(".disabled");
            let file_name = raw_name.trim_end_matches(".disabled").to_string();
            if check_content_file_name(&file_name).is_err() {
                log::warn!(
                    "Ignoring CurseForge addon with unsafe file name '{}'",
                    raw_name
                );
                continue;
            }

            mods.push(DeclaredMod {
                file_name,
                enabled,
                curseforge: Some((project_id, file_id)),
                sha1: file
                    .hashes
                    .iter()
                    .find(|hash| hash.algo == Some(1))
                    .and_then(|hash| hash.value.clone()),
                fingerprint: file.file_fingerprint,
                download_url: file.download_url.clone(),
                display_name: file.display_name.clone(),
                game_versions: (!file.game_versions.is_empty())
                    .then(|| file.game_versions.clone()),
                ..Default::default()
            });
        }

        mods
    }

    fn managed_pack(&self) -> Option<ManagedPackRef> {
        let pack = self.installed_modpack.as_ref()?;
        Some(ManagedPackRef::CurseForge {
            project_id: pack.addon_id?,
            file_id: pack.installed_file.as_ref().and_then(|file| file.id),
        })
    }
}

#[async_trait]
impl LauncherAdapter for CurseForgeAppAdapter {
    fn kind(&self) -> ExternalLauncher {
        ExternalLauncher::CurseForge
    }

    fn candidate_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("curseforge").join("minecraft"));
        }
        if let Some(documents) = dirs::document_dir() {
            roots.push(documents.join("curseforge").join("minecraft"));
        }
        roots
    }

    async fn probe(&self, root: &Path) -> Option<LauncherRoot> {
        let instances_dir =
            first_existing([root.join("Instances"), root.join("instances")]).await?;

        Some(LauncherRoot {
            launcher: ExternalLauncher::CurseForge,
            root: root.to_path_buf(),
            instances_dir,
        })
    }

    fn instance_markers(&self) -> &'static [&'static str] {
        MARKERS
    }

    async fn read_instance(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstance> {
        let manifest = MinecraftInstance::read(dir).await?;

        let name = manifest
            .name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| folder_name(dir));

        let mut reference = ExternalInstanceRef::new(root, dir, name);
        reference.game_version = manifest.game_version.clone().or_else(|| {
            manifest
                .base_mod_loader
                .as_ref()
                .and_then(|loader| loader.minecraft_version.clone())
        });
        reference.mod_count = Some(manifest.installed_addons.len());

        let pick = manifest.loader_pick();
        reference.set_loader(pick.loader, pick.loader_version.clone());

        let mut warnings = Vec::new();
        if let Some(raw) = pick.unrecognized.as_deref() {
            reference.mark_unsupported(UnsupportedReason::UnknownLoader);
            warnings.push(format!("unknown_loader:{}", raw));
        }
        if reference.game_version.is_none() {
            reference.mark_unsupported(UnsupportedReason::NoGameVersion);
        }

        Ok(ExternalInstance {
            icon: manifest.icon(&root.root, dir).await,
            declared_mods: manifest.declared_mods(),
            managed_pack: manifest.managed_pack(),
            warnings,
            ..ExternalInstance::new(reference, dir.to_path_buf())
        })
    }
}
