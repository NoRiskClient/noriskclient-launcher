use super::buckets;
use crate::integrations::pack_preview::NoriskPackOffer;
use crate::integrations::provenance::{ExecutableContentReport, ProvenanceReport};
use crate::state::profile_state::{ImageSource, ModLoader};
use crate::utils::import_safety::ImportSecurityReport;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ExternalLauncher {
    PrismLauncher,
    MultiMc,
    AtLauncher,
    GdLauncher,
    CurseForge,
    VanillaLauncher,
    ModrinthApp,
}

impl ExternalLauncher {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PrismLauncher => "prism_launcher",
            Self::MultiMc => "multimc",
            Self::AtLauncher => "atlauncher",
            Self::GdLauncher => "gdlauncher",
            Self::CurseForge => "curseforge",
            Self::VanillaLauncher => "vanilla_launcher",
            Self::ModrinthApp => "modrinth_app",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::PrismLauncher => "Prism Launcher",
            Self::MultiMc => "MultiMC",
            Self::AtLauncher => "ATLauncher",
            Self::GdLauncher => "GDLauncher",
            Self::CurseForge => "CurseForge App",
            Self::VanillaLauncher => "Minecraft Launcher",
            Self::ModrinthApp => "Modrinth App",
        }
    }

    pub fn suggested_group(&self) -> &'static str {
        match self {
            Self::PrismLauncher => "PRISM",
            Self::MultiMc => "MULTIMC",
            Self::AtLauncher => "ATLAUNCHER",
            Self::GdLauncher => "GDLAUNCHER",
            Self::CurseForge => "CURSEFORGE",
            Self::VanillaLauncher => "MINECRAFT",
            Self::ModrinthApp => "MODRINTH",
        }
    }
}

#[derive(Clone, Debug)]
pub struct LauncherRoot {
    pub launcher: ExternalLauncher,
    pub root: PathBuf,
    pub instances_dir: PathBuf,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLauncher {
    pub launcher: ExternalLauncher,
    pub display_name: String,
    pub root: String,
    pub instances_dir: String,
    pub instance_count: usize,
    pub auto_detected: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnsupportedReason {
    NoGameVersion,
    UnknownLoader,
    Unreadable,
    NoGameDirectory,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInstanceRef {
    pub launcher: ExternalLauncher,
    pub root: String,
    pub instance_dir: String,
    pub folder_name: String,
    pub name: String,
    pub game_version: Option<String>,
    pub loader: String,
    pub loader_version: Option<String>,
    pub last_played: Option<DateTime<Utc>>,
    pub mod_count: Option<usize>,
    pub icon_path: Option<String>,
    pub unsupported: Option<UnsupportedReason>,
}

impl ExternalInstanceRef {
    pub fn new(root: &LauncherRoot, dir: &std::path::Path, name: String) -> Self {
        Self {
            launcher: root.launcher,
            root: root.root.display().to_string(),
            instance_dir: dir.display().to_string(),
            folder_name: folder_name(dir),
            name,
            game_version: None,
            loader: ModLoader::Vanilla.as_str().to_string(),
            loader_version: None,
            last_played: None,
            mod_count: None,
            icon_path: None,
            unsupported: None,
        }
    }

    pub fn set_loader(&mut self, loader: ModLoader, version: Option<String>) {
        self.loader = loader.as_str().to_string();
        self.loader_version = version;
    }

    pub fn mark_unsupported(&mut self, reason: UnsupportedReason) {
        if self.unsupported.is_none() {
            self.unsupported = Some(reason);
        }
    }

    pub fn loader(&self) -> ModLoader {
        ModLoader::from_str(&self.loader).unwrap_or(ModLoader::Vanilla)
    }
}

pub fn folder_name(dir: &std::path::Path) -> String {
    dir.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[derive(Clone, Debug)]
pub enum IconRef {
    File(PathBuf),
    Url(String),
}

impl IconRef {
    pub fn file_path(&self) -> Option<String> {
        match self {
            Self::File(path) => Some(path.display().to_string()),
            Self::Url(_) => None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum ManagedPackRef {
    Modrinth {
        project_id: String,
        version_id: Option<String>,
    },
    CurseForge {
        project_id: u32,
        file_id: Option<u32>,
    },
}

impl ManagedPackRef {
    pub fn label(&self) -> String {
        match self {
            Self::Modrinth { project_id, .. } => format!("modrinth:{}", project_id),
            Self::CurseForge { project_id, .. } => format!("curseforge:{}", project_id),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct DeclaredMod {
    pub file_name: String,
    pub enabled: bool,
    pub curseforge: Option<(u32, u32)>,
    pub modrinth: Option<(String, String)>,
    pub sha1: Option<String>,
    pub fingerprint: Option<u64>,
    pub download_url: Option<String>,
    pub display_name: Option<String>,
    pub game_versions: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
pub struct ExternalInstance {
    pub reference: ExternalInstanceRef,
    pub game_dir: PathBuf,
    pub icon: Option<IconRef>,
    pub declared_mods: Vec<DeclaredMod>,
    pub managed_pack: Option<ManagedPackRef>,
    pub memory_mb: Option<(u32, u32)>,
    pub untrusted_java_path: Option<String>,
    pub untrusted_jvm_args: Option<String>,
    pub untrusted_game_args: Vec<String>,
    pub warnings: Vec<String>,
}

impl ExternalInstance {
    pub fn new(reference: ExternalInstanceRef, game_dir: PathBuf) -> Self {
        Self {
            reference,
            game_dir,
            icon: None,
            declared_mods: Vec::new(),
            managed_pack: None,
            memory_mb: None,
            untrusted_java_path: None,
            untrusted_jvm_args: None,
            untrusted_game_args: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn loader(&self) -> ModLoader {
        self.reference.loader()
    }
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportSelection {
    #[serde(default = "enabled_by_default")]
    pub mods: bool,
    #[serde(default = "enabled_by_default")]
    pub config: bool,
    #[serde(default = "enabled_by_default")]
    pub options: bool,
    #[serde(default = "enabled_by_default")]
    pub saves: bool,
    #[serde(default = "enabled_by_default")]
    pub resourcepacks: bool,
    #[serde(default = "enabled_by_default")]
    pub shaderpacks: bool,
    #[serde(default)]
    pub screenshots: bool,
    #[serde(default)]
    pub allow_executable_content: bool,
}

impl Default for ImportSelection {
    fn default() -> Self {
        Self {
            mods: true,
            config: true,
            options: true,
            saves: true,
            resourcepacks: true,
            shaderpacks: true,
            screenshots: false,
            allow_executable_content: false,
        }
    }
}

impl ImportSelection {
    pub fn includes(&self, key: &str) -> bool {
        buckets::find(key).is_some_and(|bucket| (bucket.selected)(self))
    }

    pub fn with(mut self, key: &str, value: bool) -> Self {
        if let Some(bucket) = buckets::find(key) {
            (bucket.set)(&mut self, value);
        }
        self
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContentBucket {
    pub key: String,
    pub entry_count: usize,
    pub bytes: u64,
    pub default_selected: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInstancePreview {
    pub launcher: ExternalLauncher,
    pub launcher_display_name: String,
    pub root: String,
    pub instance_dir: String,
    pub suggested_name: String,
    pub suggested_group: Option<String>,
    pub game_version: Option<String>,
    pub loader: String,
    pub loader_version: Option<String>,
    pub mod_count: usize,
    pub disabled_mod_count: usize,
    pub buckets: Vec<ContentBucket>,
    pub total_bytes: u64,
    pub selected_bytes: u64,
    pub icon: Option<ImageSource>,
    pub security: ImportSecurityReport,
    pub provenance: ProvenanceReport,
    pub executable_content: ExecutableContentReport,
    pub managed_pack: Option<String>,
    pub norisk_pack: NoriskPackOffer,
    pub warnings: Vec<String>,
    pub already_imported_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFrom {
    pub kind: String,
    pub launcher: String,
    pub launcher_display_name: String,
    pub instance_name: String,
    pub instance_dir: String,
    pub imported_at: DateTime<Utc>,
    pub schema: u8,
    pub identified_mods: usize,
    pub local_mods: usize,
}

pub const IMPORTED_FROM_KEY: &str = "imported_from";
pub const IMPORTED_FROM_KIND: &str = "external_launcher";
