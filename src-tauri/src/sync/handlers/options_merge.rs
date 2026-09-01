use crate::error::Result;
use crate::sync::context::SyncContext;
use crate::sync::handlers::{file_sha1, modified_millis, profile_state_key, read_text, SyncHandler};
use crate::sync::model::{MergeFormat, SyncTargetKind, SyncTargetState};
use crate::sync::options_format::{separator_for, OptionsDocument};
use crate::sync::report::{HandlerOutcome, PreviewAction, SyncPreviewEntry};
use crate::utils::backup_utils::{safe_write_with_backup, BackupConfig};
use crate::utils::file_utils::write_atomic;
use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct OptionsMergeHandler;

const RESOURCE_PACK_DIR: &str = "resourcepacks";

fn settings(kind: &SyncTargetKind) -> (MergeFormat, Vec<String>) {
    match kind {
        SyncTargetKind::FileMerge { format, local_keys } => (*format, local_keys.clone()),
        _ => (MergeFormat::default(), Vec::new()),
    }
}

fn effective_local_keys(ctx: &SyncContext<'_>, local_keys: Vec<String>) -> Vec<String> {
    if ctx.is_dir_linked(RESOURCE_PACK_DIR) {
        Vec::new()
    } else {
        local_keys
    }
}

async fn load(path: &Path, separator: char) -> Option<OptionsDocument> {
    read_text(path)
        .await
        .map(|text| OptionsDocument::parse(&text, separator))
}

#[async_trait]
impl SyncHandler for OptionsMergeHandler {
    async fn apply_pre_launch(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        let (format, local_keys) = settings(&ctx.target.kind);
        let separator = separator_for(format);
        let local_keys = effective_local_keys(ctx, local_keys);

        let master = ctx.master_path()?;
        let instance = ctx.instance_path()?;

        let mut outcome = HandlerOutcome::unchanged();

        let own_mtime = modified_millis(&instance).await.unwrap_or(i64::MIN);
        let mut candidates: Vec<(i64, PathBuf)> = Vec::new();

        if let Some(mtime) = modified_millis(&master).await {
            if mtime > own_mtime {
                candidates.push((mtime, master.clone()));
            }
        }

        for (profile_id, path) in ctx.subscriber_target_paths() {
            if profile_id == ctx.profile.id || path == instance {
                continue;
            }
            if let Some(mtime) = modified_millis(&path).await {
                if mtime > own_mtime {
                    candidates.push((mtime, path));
                }
            }
        }

        candidates.sort_by_key(|(mtime, _)| *mtime);

        let instance_doc = load(&instance, separator).await;
        let had_instance_file = instance_doc.is_some();
        let mut target = match instance_doc {
            Some(doc) => doc,
            None => match load(&master, separator).await {
                Some(doc) => doc,
                None => OptionsDocument::empty(separator),
            },
        };

        let mut changed = false;
        for (_, path) in &candidates {
            if let Some(doc) = load(path, separator).await {
                changed |= target.apply(&doc, &local_keys);
            }
        }

        let rendered = target.render();

        if changed || !had_instance_file {
            if rendered.is_empty() {
                return Ok(outcome);
            }

            if let Some(parent) = instance.parent() {
                fs::create_dir_all(parent).await?;
            }

            let state_key = profile_state_key(&ctx.target.path, ctx.profile.id);
            let known = ctx.manager.get_target_state(ctx.pack.id, &state_key).await?;

            if known.content_sha1.is_none() && had_instance_file {
                safe_write_with_backup(&instance, &rendered, Some("sync"), &BackupConfig::default())
                    .await?;
            } else {
                write_atomic(&instance, &rendered).await?;
            }

            outcome.changed = true;
            outcome
                .messages
                .push(format!("Merged '{}' from the sync pack", ctx.target.path));
        }

        let mut master_doc = load(&master, separator)
            .await
            .unwrap_or_else(|| OptionsDocument::empty(separator));
        if master_doc.apply(&target, &local_keys) || !master.exists() {
            if let Some(parent) = master.parent() {
                fs::create_dir_all(parent).await?;
            }
            let master_rendered = master_doc.render();
            if !master_rendered.is_empty() {
                write_atomic(&master, &master_rendered).await?;
            }
        }

        let state_key = profile_state_key(&ctx.target.path, ctx.profile.id);
        ctx.manager
            .set_target_state(
                ctx.pack.id,
                &state_key,
                &SyncTargetState {
                    last_sync: Some(Utc::now().timestamp_millis()),
                    content_sha1: file_sha1(&instance).await,
                    last_source_profile: Some(ctx.profile.id),
                },
            )
            .await?;

        Ok(outcome)
    }

    async fn write_back_post_exit(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        let (format, local_keys) = settings(&ctx.target.kind);
        let separator = separator_for(format);
        let local_keys = effective_local_keys(ctx, local_keys);

        let master = ctx.master_path()?;
        let instance = ctx.instance_path()?;

        let Some(instance_sha1) = file_sha1(&instance).await else {
            return Ok(HandlerOutcome::unchanged());
        };

        let state_key = profile_state_key(&ctx.target.path, ctx.profile.id);
        let known = ctx.manager.get_target_state(ctx.pack.id, &state_key).await?;
        if known.content_sha1.as_deref() == Some(instance_sha1.as_str()) {
            return Ok(HandlerOutcome::unchanged());
        }

        let instance_mtime = modified_millis(&instance).await.unwrap_or(i64::MIN);
        let master_mtime = modified_millis(&master).await.unwrap_or(i64::MIN);

        if master_mtime > instance_mtime {
            warn!(
                "Sync pack master for '{}' is newer than the instance file, skipping the write back",
                ctx.target.path
            );
            return Ok(HandlerOutcome::unchanged().with_warning(format!(
                "Another instance changed '{}' more recently, the write back was skipped",
                ctx.target.path
            )));
        }

        let Some(instance_doc) = load(&instance, separator).await else {
            return Ok(HandlerOutcome::unchanged());
        };
        let mut master_doc = load(&master, separator)
            .await
            .unwrap_or_else(|| OptionsDocument::empty(separator));

        let changed = master_doc.apply(&instance_doc, &local_keys) || !master.exists();
        if changed {
            if let Some(parent) = master.parent() {
                fs::create_dir_all(parent).await?;
            }
            write_atomic(&master, master_doc.render()).await?;
        }

        ctx.manager
            .set_target_state(
                ctx.pack.id,
                &state_key,
                &SyncTargetState {
                    last_sync: Some(Utc::now().timestamp_millis()),
                    content_sha1: Some(instance_sha1),
                    last_source_profile: Some(ctx.profile.id),
                },
            )
            .await?;

        let mut outcome = HandlerOutcome::unchanged();
        outcome.changed = changed;
        if changed {
            outcome.messages.push(format!(
                "Wrote '{}' back into the sync pack",
                ctx.target.path
            ));
        }
        Ok(outcome)
    }

    async fn preview(&self, ctx: &SyncContext<'_>) -> Option<SyncPreviewEntry> {
        Some(ctx.preview_entry(PreviewAction::Merge))
    }
}

#[cfg(test)]
#[path = "options_merge_scenario_test.rs"]
mod scenario_tests;
