use crate::error::Result;
use crate::sync::context::SyncContext;
use crate::sync::handlers::SyncHandler;
use crate::sync::model::{AdoptStrategy, DetachMode, SyncTargetKind};
use crate::sync::handlers::modified_millis;
use crate::sync::report::{HandlerOutcome, PreviewAction, SyncPreviewEntry};
use crate::utils::path_utils;
use crate::utils::symlink_utils;
use async_trait::async_trait;
use chrono::Utc;
use log::{info, warn};
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct DirLinkHandler;

async fn exists_on_disk(path: &Path) -> bool {
    fs::symlink_metadata(path).await.is_ok()
}

async fn is_link(path: &Path) -> bool {
    symlink_utils::is_symlink(path).await.unwrap_or(false)
}

async fn points_at(link: &Path, master: &Path) -> bool {
    let resolved_link = fs::canonicalize(link).await.ok();
    let resolved_master = fs::canonicalize(master).await.ok();
    match (resolved_link, resolved_master) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

async fn is_same_location(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a).await, fs::canonicalize(b).await) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

async fn move_entry(source: &Path, destination: &Path, ctx: &SyncContext<'_>) -> Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await?;
    }

    match fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(_) => {
            let meta = fs::symlink_metadata(source).await?;
            if meta.is_dir() {
                path_utils::copy_dir_recursively(source, destination, ctx.io_semaphore.clone())
                    .await?;
                fs::remove_dir_all(source).await?;
            } else {
                fs::copy(source, destination).await?;
                fs::remove_file(source).await?;
            }
            Ok(())
        }
    }
}

fn backup_dir_for(link: &Path) -> PathBuf {
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let name = link
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sync".to_string());
    let parent = link.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    parent.join(format!("{}.local-{}", name, stamp))
}

impl DirLinkHandler {
    async fn adopt(
        &self,
        ctx: &SyncContext<'_>,
        link: &Path,
        master: &Path,
        strategy: AdoptStrategy,
        outcome: &mut HandlerOutcome,
    ) -> Result<bool> {
        let backup_root = backup_dir_for(link);
        let holds_our_copy = ctx
            .manager
            .is_adopted(ctx.pack.id, &ctx.target.path, ctx.profile.id)
            .await
            .unwrap_or(false);
        let mut entries = fs::read_dir(link).await?;
        let mut moved = 0usize;
        let mut backed_up = 0usize;
        let mut discarded = 0usize;

        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let source = entry.path();
            let destination = master.join(&name);

            if !exists_on_disk(&destination).await {
                move_entry(&source, &destination, ctx).await?;
                moved += 1;
                continue;
            }

            if holds_our_copy {
                let removed = match fs::symlink_metadata(&source).await {
                    Ok(meta) if meta.is_dir() => fs::remove_dir_all(&source).await,
                    Ok(_) => fs::remove_file(&source).await,
                    Err(e) => Err(e),
                };
                if removed.is_ok() {
                    discarded += 1;
                    continue;
                }
            }

            let instance_wins = match strategy {
                AdoptStrategy::BackupLocal => false,
                AdoptStrategy::PreferMaster => false,
                AdoptStrategy::PreferInstance => true,
                AdoptStrategy::PreferNewer => {
                    let a = modified_millis(&source).await.unwrap_or(0);
                    let b = modified_millis(&destination).await.unwrap_or(0);
                    a > b
                }
            };

            if instance_wins {
                let loser = backup_root.join(&name);
                move_entry(&destination, &loser, ctx).await?;
                move_entry(&source, &destination, ctx).await?;
                moved += 1;
                backed_up += 1;
            } else {
                let loser = backup_root.join(&name);
                move_entry(&source, &loser, ctx).await?;
                backed_up += 1;
            }
        }

        if backed_up > 0 {
            outcome.warnings.push(format!(
                "{} entr(y/ies) of '{}' collided and were kept in {}",
                backed_up,
                ctx.target.path,
                backup_root.display()
            ));
        }

        if discarded > 0 {
            outcome.messages.push(format!(
                "Dropped {} local cop(y/ies) of '{}' that the sync pack already holds",
                discarded, ctx.target.path
            ));
        }

        match fs::remove_dir(link).await {
            Ok(()) => {
                outcome.messages.push(format!(
                    "Adopted {} entr(y/ies) of '{}' into the sync pack master",
                    moved, ctx.target.path
                ));
                Ok(true)
            }
            Err(e) => {
                outcome.warnings.push(format!(
                    "Could not replace '{}' with a link, the folder is not empty: {}",
                    ctx.target.path, e
                ));
                Ok(false)
            }
        }
    }
}

#[async_trait]
impl SyncHandler for DirLinkHandler {
    async fn apply_pre_launch(&self, ctx: &SyncContext<'_>) -> Result<HandlerOutcome> {
        let master = ctx.master_path()?;
        let link = ctx.instance_path()?;
        fs::create_dir_all(&master).await?;

        let mut outcome = HandlerOutcome::unchanged();

        if is_same_location(&master, &link).await {
            outcome.messages.push(format!(
                "'{}' is the shared folder itself, the other profiles link to it",
                ctx.target.path
            ));
            return Ok(outcome);
        }

        if exists_on_disk(&link).await {
            if is_link(&link).await {
                if points_at(&link, &master).await {
                    return Ok(outcome);
                }
                symlink_utils::remove_symlink(&link).await?;
                outcome.messages.push(format!(
                    "Repointed '{}' at the sync pack master",
                    ctx.target.path
                ));
            } else {
                let metadata = fs::symlink_metadata(&link).await?;
                if !metadata.is_dir() {
                    return Ok(outcome.with_warning(format!(
                        "'{}' is a file, only folders can be linked",
                        ctx.target.path
                    )));
                }

                let strategy = match &ctx.target.kind {
                    SyncTargetKind::DirLink { adopt } => *adopt,
                    _ => AdoptStrategy::default(),
                };

                let replaced = self
                    .adopt(ctx, &link, &master, strategy, &mut outcome)
                    .await?;
                if !replaced {
                    return Ok(outcome);
                }

                ctx.manager
                    .mark_adopted(ctx.pack.id, &ctx.target.path, ctx.profile.id)
                    .await?;
            }
        }

        if let Some(parent) = link.parent() {
            fs::create_dir_all(parent).await?;
        }

        symlink_utils::create_symlink(&master, &link, true).await?;
        info!(
            "Linked '{}' of profile '{}' to sync pack '{}'",
            ctx.target.path, ctx.profile.name, ctx.pack.name
        );

        outcome.changed = true;
        Ok(outcome)
    }

    async fn detach(&self, ctx: &SyncContext<'_>, mode: DetachMode) -> Result<HandlerOutcome> {
        if matches!(mode, DetachMode::LeaveLink) {
            return Ok(HandlerOutcome::unchanged());
        }

        let link = ctx.instance_path()?;
        if !exists_on_disk(&link).await || !is_link(&link).await {
            return Ok(HandlerOutcome::unchanged());
        }

        if ctx.instance_shared_with_other_subscriber {
            return Ok(HandlerOutcome::unchanged().with_warning(format!(
                "Kept the link for '{}' because another profile shares this folder and still uses the pack",
                ctx.target.path
            )));
        }

        let master = ctx.master_path()?;
        symlink_utils::remove_symlink(&link).await?;
        fs::create_dir_all(&link).await?;

        let mut outcome = HandlerOutcome::changed();

        if matches!(mode, DetachMode::KeepCopy) && master.exists() {
            match path_utils::copy_dir_recursively(&master, &link, ctx.io_semaphore.clone()).await {
                Ok(()) => outcome
                    .messages
                    .push(format!("Restored a local copy of '{}'", ctx.target.path)),
                Err(e) => {
                    warn!(
                        "Could not restore a local copy of '{}': {}",
                        ctx.target.path, e
                    );
                    outcome.warnings.push(format!(
                        "Could not restore a local copy of '{}': {}",
                        ctx.target.path, e
                    ));
                }
            }
        }

        if !matches!(mode, DetachMode::KeepCopy) {
            ctx.manager
                .clear_adoption(ctx.pack.id, &ctx.target.path, ctx.profile.id)
                .await?;
        }

        Ok(outcome)
    }

    async fn preview(&self, ctx: &SyncContext<'_>) -> Option<SyncPreviewEntry> {
        let master = ctx.master_path().ok()?;
        let instance = ctx.instance_path().ok()?;

        if is_same_location(&master, &instance).await {
            return Some(ctx.preview_entry(PreviewAction::Source));
        }
        if !exists_on_disk(&instance).await {
            return Some(ctx.preview_entry(PreviewAction::Link));
        }
        if is_link(&instance).await {
            return Some(ctx.preview_entry(PreviewAction::Relink));
        }

        let mut entry = ctx.preview_entry(PreviewAction::Adopt);
        let holds_our_copy = ctx
            .manager
            .is_adopted(ctx.pack.id, &ctx.target.path, ctx.profile.id)
            .await
            .unwrap_or(false);

        if let Ok(mut dir) = fs::read_dir(&instance).await {
            while let Ok(Some(item)) = dir.next_entry().await {
                if exists_on_disk(&master.join(item.file_name())).await {
                    if !holds_our_copy {
                        entry.collisions += 1;
                    }
                } else {
                    entry.moves += 1;
                }
            }
        }

        if entry.collisions > 0 {
            entry.backup_hint = instance
                .file_name()
                .map(|name| format!("{}.local-<time>", name.to_string_lossy()));
        }

        Some(entry)
    }
}
