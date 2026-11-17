use crate::state::profile_state::Mod;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncTargetResult {
    pub target_path: String,
    pub kind: String,
    pub changed: bool,
    pub messages: Vec<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

impl SyncTargetResult {
    pub fn reports_anything(&self) -> bool {
        self.changed
            || self.error.is_some()
            || !self.messages.is_empty()
            || !self.warnings.is_empty()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncPackResult {
    pub pack_id: Uuid,
    pub pack_name: String,
    pub skipped: bool,
    pub targets: Vec<SyncTargetResult>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncConflict {
    pub path: String,
    pub winner_pack_id: Uuid,
    pub winner_pack_name: String,
    pub winner_kind: String,
    pub loser_pack_id: Uuid,
    pub loser_pack_name: String,
    pub loser_kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncReport {
    pub profile_id: Option<Uuid>,
    pub packs: Vec<SyncPackResult>,
    pub conflicts: Vec<SyncConflict>,
    pub warnings: Vec<String>,
}

impl SyncReport {
    pub fn changed_targets(&self) -> usize {
        self.packs
            .iter()
            .flat_map(|p| p.targets.iter())
            .filter(|t| t.changed)
            .count()
    }

    pub fn is_empty(&self) -> bool {
        self.packs.is_empty() && self.conflicts.is_empty() && self.warnings.is_empty()
    }
}

#[derive(Clone, Debug, Default)]
pub struct HandlerOutcome {
    pub changed: bool,
    pub messages: Vec<String>,
    pub warnings: Vec<String>,
    pub extra_mods: Vec<Mod>,
    pub extra_local_jars: Vec<PathBuf>,
}

impl HandlerOutcome {
    pub fn unchanged() -> Self {
        Self::default()
    }

    pub fn changed() -> Self {
        Self {
            changed: true,
            ..Default::default()
        }
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.messages.push(message.into());
        self
    }

    pub fn with_warning(mut self, warning: impl Into<String>) -> Self {
        self.warnings.push(warning.into());
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct LaunchSyncResult {
    pub report: SyncReport,
    pub extra_mods: Vec<Mod>,
    pub extra_local_jars: Vec<PathBuf>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PreviewAction {
    #[default]
    Link,
    Relink,
    Adopt,
    Source,
    Merge,
    Copy,
    Replace,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncPreviewEntry {
    pub pack_id: Uuid,
    pub pack_name: String,
    pub target_path: String,
    pub kind: String,
    pub action: PreviewAction,
    pub moves: usize,
    pub collisions: usize,
    pub backup_hint: Option<String>,
}

impl SyncPreviewEntry {
    pub fn new(
        pack_id: Uuid,
        pack_name: &str,
        target_path: &str,
        kind: &str,
        action: PreviewAction,
    ) -> Self {
        Self {
            pack_id,
            pack_name: pack_name.to_string(),
            target_path: target_path.to_string(),
            kind: kind.to_string(),
            action,
            ..Default::default()
        }
    }
}
