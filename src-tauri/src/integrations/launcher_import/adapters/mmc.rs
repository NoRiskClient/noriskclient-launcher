use super::super::adapter::{exists, first_existing, resolve_game_dir, LauncherAdapter};
use super::super::cfg::{read_cfg, CfgFile};
use super::super::loader_map;
use super::super::model::*;
use crate::error::{AppError, Result};
use crate::state::profile_state::ModLoader;
use crate::utils::import_safety::safe_file_component;
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};

const MARKERS: &[&str] = &["instance.cfg", "mmc-pack.json"];
const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "ico", "svg"];
const GENERIC_ICON_KEYS: &[&str] = &["default", "flame", "fabric", "forge", "neoforge", "quilt"];

#[derive(Deserialize)]
struct MmcPack {
    #[serde(default)]
    components: Vec<MmcComponent>,
}

#[derive(Deserialize)]
struct MmcComponent {
    #[serde(default)]
    uid: String,
    #[serde(default)]
    version: Option<String>,
}

pub struct MmcAdapter {
    launcher: ExternalLauncher,
    config_name: &'static str,
}

impl MmcAdapter {
    pub const fn prism() -> Self {
        Self {
            launcher: ExternalLauncher::PrismLauncher,
            config_name: "prismlauncher.cfg",
        }
    }

    pub const fn multimc() -> Self {
        Self {
            launcher: ExternalLauncher::MultiMc,
            config_name: "multimc.cfg",
        }
    }

    fn prism_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(data) = dirs::data_dir() {
            roots.push(data.join("PrismLauncher"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(
                home.join(".var")
                    .join("app")
                    .join("org.prismlauncher.PrismLauncher")
                    .join("data")
                    .join("PrismLauncher"),
            );
            roots.push(home.join(".local").join("share").join("PrismLauncher"));
        }
        roots
    }

    fn multimc_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(data) = dirs::data_dir() {
            roots.push(data.join("multimc"));
            roots.push(data.join("MultiMC"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("MultiMC"));
            roots.push(home.join("Desktop").join("MultiMC"));
            roots.push(home.join("Downloads").join("MultiMC"));
            roots.push(home.join("Applications").join("MultiMC.app").join("Data"));
        }
        roots.push(PathBuf::from("/Applications/MultiMC.app/Data"));
        roots.push(PathBuf::from("C:\\MultiMC"));
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(key) {
                roots.push(PathBuf::from(base).join("MultiMC"));
            }
        }
        roots
    }

    fn resolve_instances_dir(root: &Path, config: &CfgFile) -> PathBuf {
        let declared = config.get_non_empty("InstanceDir").unwrap_or("instances");
        let candidate = if Path::new(declared).is_absolute() {
            PathBuf::from(declared)
        } else {
            root.join(declared)
        };

        if stays_inside(root, &candidate) {
            candidate
        } else {
            log::warn!(
                "Ignoring InstanceDir '{}' of '{}' because it escapes the launcher root",
                declared,
                root.display()
            );
            root.join("instances")
        }
    }

    async fn icon_for(root: &Path, config: &CfgFile) -> Option<IconRef> {
        let key = config.get_non_empty("iconKey")?;
        if GENERIC_ICON_KEYS.contains(&key) {
            return None;
        }
        let safe = safe_file_component(key).ok()?;

        let candidates: Vec<PathBuf> = ICON_EXTENSIONS
            .iter()
            .map(|extension| root.join("icons").join(format!("{}.{}", safe, extension)))
            .collect();

        first_existing(candidates).await.map(IconRef::File)
    }
}

fn stays_inside(root: &Path, candidate: &Path) -> bool {
    let normalize = |path: &Path| -> PathBuf {
        let mut out = PathBuf::new();
        for component in path.components() {
            match component {
                Component::ParentDir => {
                    out.pop();
                }
                Component::CurDir => {}
                other => out.push(other.as_os_str()),
            }
        }
        out
    };

    normalize(candidate).starts_with(normalize(root))
}

fn last_played(config: &CfgFile) -> Option<DateTime<Utc>> {
    Utc.timestamp_millis_opt(config.get_i64("lastLaunchTime")?)
        .single()
}

fn managed_pack(config: &CfgFile) -> Option<ManagedPackRef> {
    if !config.get_bool("ManagedPack").unwrap_or(false) {
        return None;
    }

    let id = config.get_non_empty("ManagedPackID")?;
    let version = config
        .get_non_empty("ManagedPackVersionID")
        .map(str::to_string);

    match config
        .get_non_empty("ManagedPackType")?
        .to_ascii_lowercase()
        .as_str()
    {
        "modrinth" => Some(ManagedPackRef::Modrinth {
            project_id: id.to_string(),
            version_id: version,
        }),
        "flame" => Some(ManagedPackRef::CurseForge {
            project_id: id.parse().ok()?,
            file_id: version.and_then(|value| value.parse().ok()),
        }),
        _ => None,
    }
}

fn memory(config: &CfgFile) -> Option<(u32, u32)> {
    if !config.get_bool("OverrideMemory").unwrap_or(false) {
        return None;
    }
    Some((
        config.get_u32("MinMemAlloc")?,
        config.get_u32("MaxMemAlloc")?,
    ))
}

#[async_trait]
impl LauncherAdapter for MmcAdapter {
    fn kind(&self) -> ExternalLauncher {
        self.launcher
    }

    fn candidate_roots(&self) -> Vec<PathBuf> {
        match self.launcher {
            ExternalLauncher::PrismLauncher => Self::prism_roots(),
            _ => Self::multimc_roots(),
        }
    }

    async fn probe(&self, root: &Path) -> Option<LauncherRoot> {
        let config_path = root.join(self.config_name);
        if !exists(&config_path).await {
            return None;
        }

        let config = read_cfg(&config_path).await.ok()?;

        Some(LauncherRoot {
            launcher: self.launcher,
            root: root.to_path_buf(),
            instances_dir: Self::resolve_instances_dir(root, &config),
        })
    }

    fn instance_markers(&self) -> &'static [&'static str] {
        MARKERS
    }

    async fn read_instance(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstance> {
        let config = read_cfg(&dir.join("instance.cfg")).await?;
        let raw = tokio::fs::read(dir.join("mmc-pack.json"))
            .await
            .map_err(AppError::Io)?;
        let pack: MmcPack = serde_json::from_slice(&raw).map_err(AppError::Json)?;

        let name = config
            .get_non_empty("name")
            .map(str::to_string)
            .unwrap_or_else(|| folder_name(dir));

        let mut reference = ExternalInstanceRef::new(root, dir, name);
        reference.last_played = last_played(&config);

        let mut loader = ModLoader::Vanilla;
        let mut loader_version = None;

        for component in &pack.components {
            if component.uid.eq_ignore_ascii_case("net.minecraft") {
                reference.game_version = component.version.clone();
            } else if let Some(found) = loader_map::loader_from_mmc_uid(&component.uid) {
                loader = found;
                loader_version = component.version.clone();
            }
        }

        reference.set_loader(loader, loader_version);

        if reference.game_version.is_none() {
            reference.mark_unsupported(UnsupportedReason::NoGameVersion);
        }

        let game_dir = match resolve_game_dir(dir).await {
            Some(game_dir) => game_dir,
            None => {
                reference.mark_unsupported(UnsupportedReason::NoGameDirectory);
                dir.to_path_buf()
            }
        };

        let overrides_java = config.get_bool("OverrideJavaLocation").unwrap_or(false);
        let overrides_args = config.get_bool("OverrideJavaArgs").unwrap_or(false);

        Ok(ExternalInstance {
            icon: Self::icon_for(&root.root, &config).await,
            managed_pack: managed_pack(&config),
            memory_mb: memory(&config),
            untrusted_java_path: overrides_java
                .then(|| config.get_non_empty("JavaPath").map(str::to_string))
                .flatten(),
            untrusted_jvm_args: overrides_args
                .then(|| config.get_non_empty("JvmArgs").map(str::to_string))
                .flatten(),
            ..ExternalInstance::new(reference, game_dir)
        })
    }
}