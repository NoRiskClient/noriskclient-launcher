use serde::Serialize;
use std::collections::HashMap;
use crate::commands::content_command::InstallContentPayload;
use crate::error::{AppError, CommandError};
use crate::state::profile_state::{find_mod_by_project_id, ModLoader};
use crate::state::state_manager::State;
use crate::sync::engine::SyncEngine;
use crate::sync::ingest::{self, DroppedSyncResult};
use crate::sync::model::{
    DetachMode, SyncPack, SyncPackSubscriber, SyncTarget, SyncTargetKind,
    VersionOverride,
};
use crate::sync::report::{SyncConflict, SyncPreviewEntry, SyncReport};
use crate::sync::resolution::{self, SyncPackModMatrix, SyncPackModMatrixRow};
use crate::sync::{paths, shortcuts, subscribers};
use crate::utils::{import_safety, trash_utils};
use chrono::Utc;
use log::{info, warn};
use serde::Deserialize;
use std::path::PathBuf;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

fn default_enabled() -> bool {
    true
}

#[tauri::command]
pub async fn get_sync_packs() -> Result<Vec<SyncPack>, CommandError> {
    let state = State::get().await?;
    let packs = state.sync_pack_manager.list_packs().await?;
    Ok(packs)
}

#[tauri::command]
pub async fn get_sync_pack(pack_id: Uuid) -> Result<Option<SyncPack>, CommandError> {
    let state = State::get().await?;
    Ok(state.sync_pack_manager.get_pack(pack_id).await?)
}

#[derive(Debug, Deserialize)]
pub struct CreateSyncPackParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[tauri::command]
pub async fn create_sync_pack(params: CreateSyncPackParams) -> Result<SyncPack, CommandError> {
    let name = params.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Other("Sync pack name must not be empty".to_string()).into());
    }

    let state = State::get().await?;
    Ok(state
        .sync_pack_manager
        .create_pack(name, params.description, params.icon)
        .await?)
}

#[derive(Debug, Deserialize)]
pub struct UpdateSyncPackParams {
    pub pack_id: Uuid,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub clear_description: bool,
    #[serde(default)]
    pub clear_icon: bool,
}

#[tauri::command]
pub async fn update_sync_pack(params: UpdateSyncPackParams) -> Result<SyncPack, CommandError> {
    let clearable = |clear: bool, value: Option<String>| {
        if clear {
            Some(None)
        } else {
            value.map(Some)
        }
    };

    let state = State::get().await?;
    Ok(state
        .sync_pack_manager
        .update_pack_meta(
            params.pack_id,
            params.name,
            clearable(params.clear_description, params.description),
            clearable(params.clear_icon, params.icon),
            params.enabled,
            params.sort_order,
        )
        .await?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSyncPackIconParams {
    pub pack_id: Uuid,
    pub path: String,
}

#[tauri::command]
pub async fn import_sync_pack_icon(
    params: ImportSyncPackIconParams,
) -> Result<String, CommandError> {
    let source = std::path::PathBuf::from(&params.path);
    if !source.is_file() {
        return Err(AppError::Other(format!("'{}' is not a file", params.path)).into());
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| {
            matches!(value.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
        })
        .ok_or_else(|| {
            AppError::Other(format!("'{}' is not a supported image", params.path))
        })?;

    let state = State::get().await?;
    state.sync_pack_manager.require_pack(params.pack_id).await?;

    let dir = paths::pack_dir(params.pack_id);
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;

    let file_name = format!("icon-{}.{}", Utc::now().timestamp_millis(), extension);
    let destination = dir.join(&file_name);
    tokio::fs::copy(&source, &destination)
        .await
        .map_err(AppError::Io)?;

    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("icon-") && name != file_name {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    info!(
        "Imported icon for sync pack {} from {}",
        params.pack_id, params.path
    );
    Ok(destination.to_string_lossy().to_string())
}

#[derive(Debug, Deserialize)]
pub struct SyncTargetParams {
    pub pack_id: Uuid,
    #[serde(default)]
    pub target_id: Option<Uuid>,
    pub path: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub kind: SyncTargetKind,
    #[serde(default)]
    pub external_path: Option<String>,
    #[serde(default)]
    pub seed_from: Option<String>,
}

#[tauri::command]
pub async fn add_sync_pack_target(params: SyncTargetParams) -> Result<SyncTarget, CommandError> {
    if let Some(seed) = params.seed_from.as_deref() {
        if params.external_path.is_none() {
            ingest::seed_master_from(params.pack_id, &params.path, &params.kind, seed).await?;
        }
    }

    Ok(ingest::store_target(
        params.pack_id,
        SyncTarget {
            id: params.target_id.unwrap_or_else(Uuid::new_v4),
            path: params.path,
            enabled: params.enabled,
            kind: params.kind,
            external_path: params.external_path,
        },
    )
    .await?)
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncPackEntryKind {
    Target,
    Mod,
    Jar,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncPackEntryRef {
    pub pack_id: Uuid,
    pub kind: SyncPackEntryKind,
    pub id: String,
}

#[derive(Serialize, Debug, Default)]
pub struct SyncPackBatchResult {
    pub removed: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn remove_sync_pack_entries(
    entries: Vec<SyncPackEntryRef>,
) -> Result<SyncPackBatchResult, CommandError> {
    let mut result = SyncPackBatchResult::default();
    if entries.is_empty() {
        return Ok(result);
    }

    let state = State::get().await?;
    let mut mods_by_pack: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

    for entry in entries {
        match entry.kind {
            SyncPackEntryKind::Mod => match Uuid::parse_str(&entry.id) {
                Ok(mod_id) => mods_by_pack.entry(entry.pack_id).or_default().push(mod_id),
                Err(_) => result.failed += 1,
            },
            SyncPackEntryKind::Target => {
                let Ok(target_id) = Uuid::parse_str(&entry.id) else {
                    result.failed += 1;
                    continue;
                };
                match state
                    .sync_pack_manager
                    .remove_target(entry.pack_id, target_id)
                    .await
                {
                    Ok(Some(removed)) => {
                        shortcuts::remove(entry.pack_id, &removed).await;
                        result.removed += 1;
                    }
                    Ok(None) => result.failed += 1,
                    Err(e) => {
                        warn!("Batch remove could not drop a target: {}", e);
                        result.failed += 1;
                    }
                }
            }
            SyncPackEntryKind::Jar => {
                match remove_sync_pack_local_jar(entry.pack_id, entry.id.clone()).await {
                    Ok(()) => result.removed += 1,
                    Err(e) => {
                        warn!("Batch remove could not drop a jar: {}", e.message);
                        result.failed += 1;
                    }
                }
            }
        }
    }

    for (pack_id, mod_ids) in mods_by_pack {
        match state.sync_pack_manager.remove_mods(pack_id, &mod_ids).await {
            Ok(removed) => result.removed += removed,
            Err(e) => {
                warn!("Batch remove failed for pack {}: {}", pack_id, e);
                result.failed += mod_ids.len();
            }
        }
    }

    info!(
        "Batch sync pack remove: {} removed, {} failed",
        result.removed, result.failed
    );
    Ok(result)
}

#[tauri::command]
pub async fn set_sync_pack_mods_enabled(
    entries: Vec<SyncPackEntryRef>,
    enabled: bool,
) -> Result<usize, CommandError> {
    if entries.is_empty() {
        return Ok(0);
    }

    let state = State::get().await?;
    let mut by_pack: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for entry in entries {
        if entry.kind != SyncPackEntryKind::Mod {
            continue;
        }
        if let Ok(mod_id) = Uuid::parse_str(&entry.id) {
            by_pack.entry(entry.pack_id).or_default().push(mod_id);
        }
    }

    let mut changed = 0;
    for (pack_id, mod_ids) in by_pack {
        match state
            .sync_pack_manager
            .set_mods_enabled(pack_id, &mod_ids, enabled)
            .await
        {
            Ok(n) => changed += n,
            Err(e) => warn!("Batch toggle failed for pack {}: {}", pack_id, e),
        }
    }

    info!("Batch sync pack toggle: {} mod(s) set to {}", changed, enabled);
    Ok(changed)
}

#[tauri::command]
pub async fn remove_sync_pack_target(pack_id: Uuid, target_id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    if let Some(removed) = state
        .sync_pack_manager
        .remove_target(pack_id, target_id)
        .await?
    {
        shortcuts::remove(pack_id, &removed).await;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct AddContentToSyncPackParams {
    pub pack_id: Uuid,
    pub payload: InstallContentPayload,
    #[serde(default)]
    pub pin_version: bool,
}

#[tauri::command]
pub async fn add_content_to_sync_pack(
    params: AddContentToSyncPackParams,
) -> Result<(), CommandError> {
    Ok(ingest::add_content(params.pack_id, &params.payload, params.pin_version).await?)
}

#[tauri::command]
pub async fn remove_content_from_sync_pack(
    pack_id: Uuid,
    project_id: String,
) -> Result<(), CommandError> {
    let state = State::get().await?;
    let mods = state.sync_pack_manager.require_pack(pack_id).await?.plain_mods();

    let Some(index) = find_mod_by_project_id(&mods, &project_id) else {
        return Ok(());
    };
    state
        .sync_pack_manager
        .remove_mod(pack_id, mods[index].id)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn remove_mod_from_sync_pack(pack_id: Uuid, mod_id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    state.sync_pack_manager.remove_mod(pack_id, mod_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_sync_pack_local_jars(pack_id: Uuid) -> Result<Vec<String>, CommandError> {
    let jars = paths::list_pack_local_jars(pack_id).await?;
    Ok(jars
        .into_iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect())
}

#[tauri::command]
pub async fn remove_sync_pack_local_jar(
    pack_id: Uuid,
    file_name: String,
) -> Result<(), CommandError> {
    let safe_name = import_safety::safe_file_component(&file_name)?;
    let path = paths::pack_mods_dir(pack_id).join(safe_name);
    if path.exists() {
        trash_utils::move_path_to_trash(&path, Some("sync_packs")).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_sync_pack_subscribers(
    pack_id: Uuid,
) -> Result<Vec<SyncPackSubscriber>, CommandError> {
    let state = State::get().await?;
    Ok(subscribers::of_pack(&state, pack_id)
        .await
        .into_iter()
        .map(|s| SyncPackSubscriber {
            profile_id: s.profile.id,
            profile_name: s.profile.name,
            instance_path: s.instance_dir.to_string_lossy().into_owned(),
        })
        .collect())
}

#[tauri::command]
pub async fn open_sync_pack_folder(
    app_handle: tauri::AppHandle,
    pack_id: Uuid,
    target_path: Option<String>,
) -> Result<String, CommandError> {
    paths::ensure_pack_dirs(pack_id).await?;

    let (path, reveal) = match target_path.as_deref().filter(|t| !t.is_empty()) {
        Some(target) => {
            let resolved = paths::master_path_for(pack_id, target)?;
            if resolved.is_dir() {
                (resolved, false)
            } else if resolved.exists() {
                (resolved, true)
            } else {
                (paths::pack_master_dir(pack_id), false)
            }
        }
        None => (paths::pack_dir(pack_id), false),
    };

    let display = path.to_string_lossy().into_owned();
    let opener = app_handle.opener();
    let result = if reveal {
        opener.reveal_item_in_dir(&path)
    } else {
        opener.open_path(&display, None::<&str>)
    };

    result.map_err(|e| {
        AppError::Other(format!("Could not open the sync pack folder: {}", e))
    })?;
    Ok(display)
}

#[derive(Debug, Deserialize)]
pub struct DeleteSyncPackParams {
    pub pack_id: Uuid,
    #[serde(default)]
    pub detach_mode: DetachMode,
}

#[tauri::command]
pub async fn delete_sync_pack(params: DeleteSyncPackParams) -> Result<(), CommandError> {
    let state = State::get().await?;

    for profile in state
        .profile_manager
        .profiles_subscribed_to(params.pack_id)
        .await
    {
        if let Err(e) =
            SyncEngine::detach_pack_from_profile(params.pack_id, profile.id, params.detach_mode)
                .await
        {
            warn!(
                "Could not detach sync pack {} from profile {}: {}",
                params.pack_id, profile.id, e
            );
        }

        let profile_id = profile.id;
        let mut updated = profile;
        updated.sync_pack_ids.retain(|id| *id != params.pack_id);
        state
            .profile_manager
            .update_profile(profile_id, updated)
            .await?;
    }

    state.sync_pack_manager.delete_pack(params.pack_id).await?;
    info!("Deleted sync pack {}", params.pack_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SetProfileSyncPacksParams {
    pub profile_id: Uuid,
    pub pack_ids: Vec<Uuid>,
    #[serde(default)]
    pub detach_mode: DetachMode,
}

#[tauri::command]
pub async fn set_profile_sync_packs(
    params: SetProfileSyncPacksParams,
) -> Result<SyncReport, CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(params.profile_id).await?;

    let mut next: Vec<Uuid> = Vec::new();
    for id in &params.pack_ids {
        state.sync_pack_manager.require_pack(*id).await?;
        if !next.contains(id) {
            next.push(*id);
        }
    }

    let removed: Vec<Uuid> = profile
        .sync_pack_ids
        .iter()
        .copied()
        .filter(|id| !next.contains(id))
        .collect();

    let mut report = SyncReport::default();
    if !removed.is_empty() {
        match SyncEngine::detach_packs_from_profile(&removed, params.profile_id, params.detach_mode)
            .await
        {
            Ok(r) => report = r,
            Err(e) => warn!(
                "Could not detach sync packs from profile {}: {}",
                params.profile_id, e
            ),
        }
    }

    if profile.sync_pack_ids == next {
        return Ok(report);
    }

    state
        .profile_manager
        .set_profile_sync_packs(params.profile_id, next)
        .await?;

    Ok(report)
}

#[tauri::command]
pub async fn get_profile_sync_conflicts(
    profile_id: Uuid,
) -> Result<Vec<SyncConflict>, CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    Ok(SyncEngine::detect_conflicts(&profile).await?)
}

#[tauri::command]
pub async fn sync_profile_now(profile_id: Uuid) -> Result<SyncReport, CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    let report = SyncEngine::prepare_for_launch(&profile).await?.report;
    Ok(report)
}

#[tauri::command]
pub async fn preview_profile_sync(
    profile_id: Uuid,
    pack_ids: Vec<Uuid>,
) -> Result<Vec<SyncPreviewEntry>, CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    Ok(SyncEngine::preview(&profile, &pack_ids).await?)
}

#[tauri::command]
pub async fn set_sync_pack_mod_enabled(
    pack_id: Uuid,
    mod_id: Uuid,
    enabled: bool,
) -> Result<(), CommandError> {
    let state = State::get().await?;
    state
        .sync_pack_manager
        .set_mod_enabled(pack_id, mod_id, enabled)
        .await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SetSyncPackModVersionOverrideParams {
    pub pack_id: Uuid,
    pub mod_id: Uuid,
    pub mc_version: String,
    #[serde(rename = "override", default)]
    pub version_override: Option<VersionOverride>,
}

#[tauri::command]
pub async fn set_sync_pack_mod_version_override(
    params: SetSyncPackModVersionOverrideParams,
) -> Result<(), CommandError> {
    let state = State::get().await?;
    state
        .sync_pack_manager
        .set_mod_version_override(
            params.pack_id,
            params.mod_id,
            &params.mc_version,
            params.version_override,
        )
        .await?;
    Ok(())
}

async fn pack_contexts(state: &State, pack_id: Uuid) -> Vec<(String, ModLoader)> {
    subscribers::contexts(&subscribers::of_pack(state, pack_id).await)
}

#[tauri::command]
pub async fn get_sync_pack_mod_matrix(
    pack_id: Uuid,
) -> Result<Vec<SyncPackModMatrix>, CommandError> {
    let state = State::get().await?;
    let pack = state.sync_pack_manager.require_pack(pack_id).await?;
    let contexts = pack_contexts(&state, pack_id).await;
    let cache = state.sync_pack_manager.get_mod_resolutions(pack_id).await?;
    Ok(resolution::matrix_for_pack(&pack, &contexts, &cache))
}

#[tauri::command]
pub async fn resolve_sync_pack_mod(
    pack_id: Uuid,
    mod_id: Uuid,
    mc_version: Option<String>,
    loader: Option<String>,
) -> Result<Vec<SyncPackModMatrixRow>, CommandError> {
    let state = State::get().await?;
    let pack = state.sync_pack_manager.require_pack(pack_id).await?;

    let entry = pack.find_entry(mod_id).ok_or_else(|| {
        AppError::Other(format!(
            "Mod {} is not part of sync pack {}",
            mod_id, pack_id
        ))
    })?;

    let project_key = resolution::project_key_of(&entry.info.source).ok_or_else(|| {
        AppError::Other("Only Modrinth and CurseForge mods can be resolved".to_string())
    })?;

    let all = pack_contexts(&state, pack_id).await;
    let targets: Vec<(String, ModLoader)> = match (mc_version, loader) {
        (Some(version), Some(loader)) => vec![(version, ModLoader::from_str(&loader)?)],
        (Some(version), None) => all.into_iter().filter(|(v, _)| *v == version).collect(),
        _ => all,
    };

    Ok(resolution::refresh_resolutions(
        &state.sync_pack_manager,
        pack_id,
        entry,
        &project_key,
        &targets,
    )
    .await?)
}

#[tauri::command]
pub async fn get_or_create_default_sync_pack() -> Result<SyncPack, CommandError> {
    let state = State::get().await?;
    if let Some(pack) = state.sync_pack_manager.list_packs().await?.into_iter().next() {
        return Ok(pack);
    }
    Ok(state
        .sync_pack_manager
        .create_pack("Default".to_string(), None, None)
        .await?)
}

#[tauri::command]
pub async fn add_dropped_sync_target(
    pack_id: Uuid,
    source_path: String,
) -> Result<DroppedSyncResult, CommandError> {
    Ok(ingest::add_dropped_path(pack_id, &PathBuf::from(source_path)).await?)
}

#[derive(Debug, serde::Serialize)]
pub struct SeedCandidate {
    pub profile_id: Uuid,
    pub profile_name: String,
    pub path: String,
    pub exists: bool,
    pub entries: usize,
    pub last_played: Option<chrono::DateTime<chrono::Utc>>,
}

#[tauri::command]
pub async fn list_sync_seed_candidates(
    relative_path: String,
) -> Result<Vec<SeedCandidate>, CommandError> {
    let state = State::get().await?;
    let profiles = state.profile_manager.list_profiles().await?;

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for profile in profiles {
        if paths::is_temp_profile_path(&profile.path) {
            continue;
        }
        let Ok(instance) = state
            .profile_manager
            .calculate_instance_path_for_profile(&profile)
        else {
            continue;
        };
        let Ok(candidate) = paths::instance_path_for(&instance, &relative_path) else {
            continue;
        };
        if !seen.insert(candidate.clone()) {
            continue;
        }

        let mut entries = 0usize;
        if let Ok(mut dir) = tokio::fs::read_dir(&candidate).await {
            while let Ok(Some(_)) = dir.next_entry().await {
                entries += 1;
            }
        }

        out.push(SeedCandidate {
            profile_id: profile.id,
            profile_name: profile.name.clone(),
            path: paths::strip_unc_prefix(&candidate.to_string_lossy()),
            exists: candidate.exists(),
            entries,
            last_played: profile.last_played,
        });
    }

    out.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then(b.entries.cmp(&a.entries))
            .then(a.profile_name.cmp(&b.profile_name))
    });
    Ok(out)
}
