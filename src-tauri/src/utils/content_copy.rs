use crate::error::{AppError, Result};
use crate::state::profile_state::{find_mod_by_project, Mod, Profile};
use crate::state::state_manager::State;
use crate::sync::resolution::{apply_resolution, platform_of, resolve_online};
use crate::utils::path_utils::copy_dir_recursively;
use crate::utils::profile_utils::{get_content_directory, ContentType};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Semaphore;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModCopy {
    Keep,
    Resolve,
    AlreadyThere,
    AsFile,
}

pub fn plan_mod_copy(entry: &Mod, source: &Profile, target: &Profile) -> ModCopy {
    if platform_of(&entry.source).is_none() {
        return ModCopy::AsFile;
    }
    if find_mod_by_project(&target.mods, &entry.source).is_some() {
        return ModCopy::AlreadyThere;
    }
    if source.game_version == target.game_version && source.loader == target.loader {
        ModCopy::Keep
    } else {
        ModCopy::Resolve
    }
}

pub fn copied_mod(entry: &Mod) -> Mod {
    let mut copy = entry.clone();
    copy.id = Uuid::new_v4();
    copy.modpack_origin = None;
    copy
}

pub fn is_copyable_path(path: &Path, roots: &[PathBuf]) -> bool {
    !path.components().any(|c| matches!(c, Component::ParentDir))
        && path
            .parent()
            .is_some_and(|parent| roots.iter().any(|root| parent == root))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileCopy {
    Copied,
    AlreadyThere,
}

pub async fn copy_content_entry(
    src: &Path,
    dest_dir: &Path,
    io: Arc<Semaphore>,
) -> Result<FileCopy> {
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Other(format!("No file name in {}", src.display())))?;
    let enabled_name = name.strip_suffix(".disabled").unwrap_or(name);

    if dest_dir.join(enabled_name).exists()
        || dest_dir.join(format!("{enabled_name}.disabled")).exists()
    {
        return Ok(FileCopy::AlreadyThere);
    }

    fs::create_dir_all(dest_dir).await?;
    let dest = dest_dir.join(name);
    if src.is_dir() {
        copy_dir_recursively(src, &dest, io).await?;
    } else {
        fs::copy(src, &dest).await?;
    }
    Ok(FileCopy::Copied)
}

#[derive(Debug, Clone, Deserialize)]
pub struct CopyContentItem {
    pub id: Option<String>,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CopyContentsRequest {
    pub source_profile_id: Uuid,
    pub target_profile_id: Uuid,
    pub content_type: ContentType,
    pub items: Vec<CopyContentItem>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CopyContentsResult {
    pub copied: Vec<String>,
    pub already_there: Vec<String>,
    pub incompatible: Vec<String>,
    pub failed: Vec<String>,
}

enum Outcome {
    Added(Mod),
    Copied,
    AlreadyThere,
    Incompatible,
    Failed,
}

impl CopyContentsResult {
    fn record(&mut self, name: String, outcome: &Outcome) {
        match outcome {
            Outcome::Added(_) | Outcome::Copied => self.copied.push(name),
            Outcome::AlreadyThere => self.already_there.push(name),
            Outcome::Incompatible => self.incompatible.push(name),
            Outcome::Failed => self.failed.push(name),
        }
    }
}

async fn copy_mod_entry(entry: &Mod, plan: ModCopy, target: &Profile) -> Outcome {
    match plan {
        ModCopy::AlreadyThere => Outcome::AlreadyThere,
        ModCopy::Keep => Outcome::Added(copied_mod(entry)),
        ModCopy::Resolve => {
            match resolve_online(&entry.source, &target.game_version, target.loader).await {
                Ok(resolved) => Outcome::Added(copied_mod(&apply_resolution(
                    entry,
                    &resolved,
                    &target.game_version,
                    target.loader,
                ))),
                Err(e) => {
                    info!(
                        "No version of {:?} fits {}: {}",
                        entry.display_name, target.name, e
                    );
                    Outcome::Incompatible
                }
            }
        }
        ModCopy::AsFile => Outcome::Failed,
    }
}

async fn copy_file_entry(
    path: &Path,
    roots: &[PathBuf],
    dest_dir: &Path,
    io: Arc<Semaphore>,
) -> Outcome {
    if !is_copyable_path(path, roots) {
        warn!(
            "Refusing to copy {} from outside the profile",
            path.display()
        );
        return Outcome::Failed;
    }
    match copy_content_entry(path, dest_dir, io).await {
        Ok(FileCopy::Copied) => Outcome::Copied,
        Ok(FileCopy::AlreadyThere) => Outcome::AlreadyThere,
        Err(e) => {
            warn!("Copying {} failed: {}", path.display(), e);
            Outcome::Failed
        }
    }
}

pub async fn copy_contents(request: CopyContentsRequest) -> Result<CopyContentsResult> {
    if request.source_profile_id == request.target_profile_id {
        return Err(AppError::Other(
            "Source and target profile are the same".to_string(),
        ));
    }
    if request.content_type == ContentType::NoRiskMod {
        return Err(AppError::Other(
            "NoRisk mods come from the pack and cannot be copied".to_string(),
        ));
    }

    let state = State::get().await?;
    let manager = &state.profile_manager;
    let source = manager.get_profile(request.source_profile_id).await?;
    let mut target = manager.get_profile(request.target_profile_id).await?;

    let roots = match request.content_type {
        ContentType::Mod => manager.mod_scan_dirs(&source)?,
        _ => vec![get_content_directory(&source, &request.content_type).await?],
    };
    let dest_dir = get_content_directory(&target, &request.content_type).await?;

    let mut result = CopyContentsResult::default();
    let mut new_mods = Vec::new();

    for item in request.items {
        let entry = item
            .id
            .as_deref()
            .and_then(|id| Uuid::parse_str(id).ok())
            .and_then(|id| source.mods.iter().find(|m| m.id == id))
            .filter(|_| request.content_type == ContentType::Mod);
        let plan = entry.map_or(ModCopy::AsFile, |entry| {
            plan_mod_copy(entry, &source, &target)
        });

        let outcome = match (plan, entry) {
            (ModCopy::AsFile, _) | (_, None) => {
                copy_file_entry(
                    Path::new(&item.path),
                    &roots,
                    &dest_dir,
                    state.io_semaphore.clone(),
                )
                .await
            }
            (plan, Some(entry)) => copy_mod_entry(entry, plan, &target).await,
        };

        result.record(item.name, &outcome);
        if let Outcome::Added(copy) = outcome {
            target.mods.push(copy.clone());
            new_mods.push(copy);
        }
    }

    manager
        .add_copied_mods(request.target_profile_id, new_mods)
        .await?;
    Ok(result)
}
