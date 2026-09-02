use crate::state::profile_state::Mod;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

fn default_true() -> bool {
    true
}

pub fn default_local_keys() -> Vec<String> {
    vec![
        "resourcePacks".to_string(),
        "incompatibleResourcePacks".to_string(),
    ]
}

#[derive(Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AdoptStrategy {
    #[default]
    BackupLocal,
    PreferNewer,
    PreferMaster,
    PreferInstance,
}

#[derive(Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MergeFormat {
    #[default]
    MinecraftOptions,
    PlainKeyValue,
}

#[derive(Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DetachMode {
    #[default]
    KeepCopy,
    Drop,
    LeaveLink,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncTargetKind {
    DirLink {
        #[serde(default)]
        adopt: AdoptStrategy,
    },
    FileMerge {
        #[serde(default)]
        format: MergeFormat,
        #[serde(default = "default_local_keys")]
        local_keys: Vec<String>,
    },
    FileCopy,
    Mods,
}

impl SyncTarget {
    pub fn claimed_paths(&self) -> Vec<String> {
        match self.kind {
            SyncTargetKind::Mods => Vec::new(),
            _ => vec![self.path.clone()],
        }
    }
}

impl SyncTargetKind {
    pub fn discriminant(&self) -> &'static str {
        match self {
            Self::DirLink { .. } => "dir_link",
            Self::FileMerge { .. } => "file_merge",
            Self::FileCopy => "file_copy",
            Self::Mods => "mods",
        }
    }

    pub fn is_dir_link(&self) -> bool {
        matches!(self, Self::DirLink { .. })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncTarget {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub path: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub kind: SyncTargetKind,
    #[serde(default)]
    pub external_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VersionOverride {
    Pin { version_id: String },
    Disabled,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPackModEntry {
    #[serde(flatten)]
    pub info: Mod,
    #[serde(default)]
    pub version_overrides: HashMap<String, VersionOverride>,
}

impl SyncPackModEntry {
    pub fn override_for(&self, mc_version: &str) -> Option<&VersionOverride> {
        self.version_overrides.get(mc_version)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPack {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub created: DateTime<Utc>,
    #[serde(default)]
    pub updated: DateTime<Utc>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub targets: Vec<SyncTarget>,
    #[serde(default)]
    pub mods: Vec<SyncPackModEntry>,
}

impl SyncPack {
    pub fn plain_mods(&self) -> Vec<Mod> {
        self.mods.iter().map(|e| e.info.clone()).collect()
    }

    pub fn find_entry(&self, mod_id: Uuid) -> Option<&SyncPackModEntry> {
        self.mods.iter().find(|e| e.info.id == mod_id)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncTargetState {
    pub last_sync: Option<i64>,
    pub content_sha1: Option<String>,
    pub last_source_profile: Option<Uuid>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPackSubscriber {
    pub profile_id: Uuid,
    pub profile_name: String,
    pub instance_path: String,
}
