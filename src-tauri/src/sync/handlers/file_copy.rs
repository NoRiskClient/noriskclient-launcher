use crate::error::Result;
use crate::sync::context::SyncContext;
use crate::sync::handlers::{file_sha1, modified_millis, profile_state_key, SyncHandler};
use crate::sync::model::SyncTargetState;
use crate::sync::report::{HandlerOutcome, PreviewAction, SyncPreviewEntry};
use crate::utils::file_utils::write_atomic;
use crate::utils::trash_utils;
use async_trait::async_trait;
use chrono::Utc;
use log::warn;
use std::path::PathBuf;
use tokio::fs;

pub struct FileCopyHandler;

#[async_trait]
impl SyncHandler for FileCopyHandler {
    async fn apply_pre_launch(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        let master = ctx.master_path()?;
        let instance = ctx.instance_path()?;

        let mut candidates: Vec<(i64, PathBuf)> = Vec::new();
        if let Some(mtime) = modified_millis(&master).await {
            candidates.push((mtime, master.clone()));
        }
        for (_, path) in ctx.subscriber_target_paths() {
            if let Some(mtime) = modified_millis(&path).await {
                candidates.push((mtime, path));
            }
        }
        if let Some(mtime) = modified_millis(&instance).await {
            candidates.push((mtime, instance.clone()));
        }

        let Some((_, winner)) = candidates.into_iter().max_by_key(|(mtime, _)| *mtime) else {
            return Ok(HandlerOutcome::unchanged());
        };

        let winner_sha1 = file_sha1(&winner).await;
        let instance_sha1 = file_sha1(&instance).await;
        let mut outcome = HandlerOutcome::unchanged();

        if winner_sha1.is_some() && winner_sha1 != instance_sha1 {
            if instance.exists() {
                if let Err(e) = trash_utils::move_path_to_trash(&instance, Some("sync")).await {
                    warn!(
                        "Could not move the previous '{}' to the trash: {}",
                        ctx.target.path, e
                    );
                }
            }
            if let Some(parent) = instance.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(&winner, &instance).await?;
            outcome.changed = true;
            outcome.messages.push(format!(
                "Copied '{}' from the sync pack",
                ctx.target.path
            ));
        }

        let master_sha1 = file_sha1(&master).await;
        if winner_sha1.is_some() && winner_sha1 != master_sha1 {
            if let Some(parent) = master.parent() {
                fs::create_dir_all(parent).await?;
            }
            let bytes = fs::read(&winner).await?;
            write_atomic(&master, &bytes).await?;
        }

        ctx.manager
            .set_target_state(
                ctx.pack.id,
                &profile_state_key(&ctx.target.path, ctx.profile.id),
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
            return Ok(HandlerOutcome::unchanged().with_warning(format!(
                "Another instance changed '{}' more recently, the write back was skipped",
                ctx.target.path
            )));
        }

        if let Some(parent) = master.parent() {
            fs::create_dir_all(parent).await?;
        }
        let bytes = fs::read(&instance).await?;
        write_atomic(&master, &bytes).await?;

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

        Ok(HandlerOutcome::changed().with_message(format!(
            "Wrote '{}' back into the sync pack",
            ctx.target.path
        )))
    }

    async fn preview(&self, ctx: &SyncContext<'_>) -> Option<SyncPreviewEntry> {
        let instance = ctx.instance_path().ok()?;
        let action = if fs::symlink_metadata(&instance).await.is_ok() {
            PreviewAction::Replace
        } else {
            PreviewAction::Copy
        };
        Some(ctx.preview_entry(action))
    }
}
