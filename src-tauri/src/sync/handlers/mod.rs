pub mod dir_link;
pub mod file_copy;
pub mod mods;
pub mod options_merge;

use crate::error::Result;
use crate::sync::context::SyncContext;
use crate::sync::model::{DetachMode, SyncTarget, SyncTargetKind};
use crate::sync::report::{HandlerOutcome, SyncPreviewEntry};
use async_trait::async_trait;
use std::path::Path;
use uuid::Uuid;

#[async_trait]
pub trait SyncHandler: Send + Sync {
    fn claims(&self, target: &SyncTarget) -> Vec<String> {
        vec![target.path.clone()]
    }

    async fn apply_pre_launch(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome>;

    async fn write_back_post_exit(&self, _ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        Ok(HandlerOutcome::unchanged())
    }

    async fn detach(&self, _ctx: &SyncContext<'_>, _mode: DetachMode) -> Result<HandlerOutcome> {
        Ok(HandlerOutcome::unchanged())
    }

    async fn preview(&self, _ctx: &SyncContext<'_>) -> Option<SyncPreviewEntry> {
        None
    }
}

static DIR_LINK: dir_link::DirLinkHandler = dir_link::DirLinkHandler;
static OPTIONS_MERGE: options_merge::OptionsMergeHandler = options_merge::OptionsMergeHandler;
static FILE_COPY: file_copy::FileCopyHandler = file_copy::FileCopyHandler;
static MODS: mods::ModsHandler = mods::ModsHandler;

pub fn handler_for(kind: &SyncTargetKind) -> &'static dyn SyncHandler {
    match kind {
        SyncTargetKind::DirLink { .. } => &DIR_LINK,
        SyncTargetKind::FileMerge { .. } => &OPTIONS_MERGE,
        SyncTargetKind::FileCopy => &FILE_COPY,
        SyncTargetKind::Mods => &MODS,
    }
}

pub async fn modified_millis(path: &Path) -> Option<i64> {
    let meta = tokio::fs::symlink_metadata(path).await.ok()?;
    let modified = meta.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

pub async fn read_text(path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn file_sha1(path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(crate::utils::hash_utils::calculate_sha1_from_bytes(&bytes))
}

pub fn profile_state_key(target_path: &str, profile_id: Uuid) -> String {
    format!("{}@{}", target_path, profile_id)
}
