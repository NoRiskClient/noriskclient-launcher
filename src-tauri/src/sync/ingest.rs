use crate::commands::content_command::InstallContentPayload;
use crate::error::{AppError, Result};
use crate::integrations::mod_dependencies::{
    resolve_required_dependencies, version_details, DependencyTarget, DEPENDENCY_DEPTH,
};
use crate::integrations::mod_lookup::{identify_jar, mod_from_unified_version};
use crate::integrations::unified_mod::ModPlatform;
use crate::state::profile_state::{
    find_mod_by_project_id, mod_platform_ids, mod_source_from_payload, upsert_mod_from_payload, Mod,
    ModUpsert,
};
use crate::state::state_manager::State;
use crate::sync::model::{
    default_local_keys, AdoptStrategy, MergeFormat, SyncTarget, SyncTargetKind, VersionOverride,
};
use crate::sync::resolution::{self, ResolvedVersion};
use crate::sync::{paths, shortcuts, subscribers};
use crate::utils::profile_utils::ContentType;
use crate::utils::path_utils;
use log::{info, warn};
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Default, serde::Serialize)]
pub struct DroppedSyncResult {
    pub target: Option<SyncTarget>,
    pub identified_mods: Vec<String>,
    pub local_jars: Vec<String>,
}

fn is_jar(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".jar")
}

fn kind_for(name: &str, is_dir: bool) -> SyncTargetKind {
    if is_dir {
        SyncTargetKind::DirLink {
            adopt: AdoptStrategy::default(),
        }
    } else if name.eq_ignore_ascii_case("options.txt") {
        SyncTargetKind::FileMerge {
            format: MergeFormat::default(),
            local_keys: default_local_keys(),
        }
    } else {
        SyncTargetKind::FileCopy
    }
}

pub async fn store_target(pack_id: Uuid, target: SyncTarget) -> Result<SyncTarget> {
    let state = State::get().await?;
    let stored = state.sync_pack_manager.upsert_target(pack_id, target).await?;
    shortcuts::refresh(pack_id, &stored).await;
    Ok(stored)
}

pub async fn add_dropped_path(pack_id: Uuid, source: &Path) -> Result<DroppedSyncResult> {
    let mut result = DroppedSyncResult::default();

    let metadata = tokio::fs::metadata(source).await.map_err(|e| {
        AppError::Other(format!("Could not read '{}': {}", source.display(), e))
    })?;

    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| {
            AppError::Other(format!(
                "Could not determine a name for '{}'",
                source.display()
            ))
        })?;

    paths::ensure_pack_dirs(pack_id).await?;

    if metadata.is_dir() && name.eq_ignore_ascii_case("mods") {
        let mut entries = tokio::fs::read_dir(source).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let Some(file_name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            if !is_jar(&file_name) || entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            add_jar(pack_id, &path, &file_name, &mut result).await?;
        }
        return Ok(result);
    }

    if !metadata.is_dir() && is_jar(&name) {
        add_jar(pack_id, source, &name, &mut result).await?;
        return Ok(result);
    }

    let kind = kind_for(&name, metadata.is_dir());
    let normalized = paths::validate_target_path(&name, &kind)?;
    let external = tokio::fs::canonicalize(source)
        .await
        .map(|p| paths::strip_unc_prefix(&p.to_string_lossy()))
        .unwrap_or_else(|_| source.to_string_lossy().into_owned());

    info!("Sync target '{}' now points at {}", normalized, external);

    result.target = Some(
        store_target(
            pack_id,
            SyncTarget {
                id: Uuid::new_v4(),
                path: normalized,
                enabled: true,
                kind,
                external_path: Some(external),
            },
        )
        .await?,
    );
    Ok(result)
}

async fn add_jar(
    pack_id: Uuid,
    source: &Path,
    file_name: &str,
    result: &mut DroppedSyncResult,
) -> Result<()> {
    if let Some(entry) = identify_jar(source).await {
        let state = State::get().await?;
        state
            .sync_pack_manager
            .add_mods(pack_id, std::slice::from_ref(&entry))
            .await?;
        result.identified_mods.push(
            entry
                .display_name
                .clone()
                .unwrap_or_else(|| file_name.to_string()),
        );

        if let Some((platform, project_id, version_id)) = mod_platform_ids(&entry.source) {
            add_dependencies(
                pack_id,
                &platform,
                &project_id,
                &version_id,
                entry.associated_loader.map(|l| l.as_str().to_string()),
                entry
                    .game_versions
                    .as_ref()
                    .and_then(|list| list.first().cloned()),
            )
            .await;
        }
        return Ok(());
    }

    info!(
        "'{}' was not found on Modrinth or CurseForge, keeping a local copy",
        file_name
    );
    copy_jar(pack_id, source, file_name).await?;
    result.local_jars.push(file_name.to_string());
    Ok(())
}

async fn copy_jar(pack_id: Uuid, source: &Path, file_name: &str) -> Result<()> {
    let destination = paths::pack_mods_dir(pack_id).join(file_name);
    tokio::fs::copy(source, &destination)
        .await
        .map_err(|e| AppError::Other(format!("Could not import '{}': {}", file_name, e)))?;
    info!(
        "Imported local jar '{}' into sync pack {}",
        file_name, pack_id
    );
    Ok(())
}

pub async fn seed_master_from(
    pack_id: Uuid,
    target_path: &str,
    kind: &SyncTargetKind,
    source_path: &str,
) -> Result<()> {
    let source = Path::new(source_path);
    if !source.exists() {
        return Ok(());
    }

    paths::ensure_pack_dirs(pack_id).await?;
    let normalized = paths::validate_target_path(target_path, kind)?;
    let master = paths::master_path_for(pack_id, &normalized)?;
    let metadata = tokio::fs::metadata(source).await?;

    if metadata.is_dir() {
        let already_filled = match tokio::fs::read_dir(&master).await {
            Ok(mut entries) => entries.next_entry().await?.is_some(),
            Err(_) => false,
        };
        if already_filled {
            return Ok(());
        }

        tokio::fs::create_dir_all(&master).await?;
        let state = State::get().await?;
        path_utils::copy_dir_recursively(source, &master, Arc::clone(&state.io_semaphore)).await?;
    } else {
        if master.exists() {
            return Ok(());
        }
        if let Some(parent) = master.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(source, &master).await?;
    }

    info!(
        "Seeded sync target '{}' of pack {} from {}",
        normalized, pack_id, source_path
    );
    Ok(())
}

pub async fn add_content(
    pack_id: Uuid,
    payload: &InstallContentPayload,
    pin_version: bool,
) -> Result<()> {
    if !matches!(payload.content_type, ContentType::Mod) {
        return Err(AppError::Other(format!(
            "Sync packs only hold mods, not {:?}",
            payload.content_type
        )));
    }

    let state = State::get().await?;
    let pack = state.sync_pack_manager.require_pack(pack_id).await?;

    let display_name = payload
        .content_name
        .as_deref()
        .unwrap_or(&payload.project_id)
        .to_string();

    let existing = pack.plain_mods();
    let mod_id = match upsert_mod_from_payload(&existing, payload, Vec::new()) {
        ModUpsert::Unchanged => {
            info!(
                "Mod {} is already part of sync pack {} in this version.",
                display_name, pack_id
            );
            find_mod_by_project_id(&existing, &payload.project_id).map(|i| existing[i].id)
        }
        ModUpsert::Replaced(entry) => {
            info!(
                "Mod {} is already part of sync pack {} in a different version. Replacing it.",
                display_name, pack_id
            );
            let id = entry.id;
            state
                .sync_pack_manager
                .add_mods(pack_id, std::slice::from_ref(&entry))
                .await?;
            Some(id)
        }
        ModUpsert::Added(entry) => {
            let id = entry.id;
            state
                .sync_pack_manager
                .add_mods(pack_id, std::slice::from_ref(&entry))
                .await?;
            info!("Added mod {} to sync pack {}", display_name, pack_id);
            Some(id)
        }
    };

    if pin_version {
        if let Some(mod_id) = mod_id {
            pin_for_matching_versions(&state, pack_id, mod_id, payload).await?;
        }
    }

    add_dependencies(
        pack_id,
        &payload.source,
        &payload.project_id,
        &payload.version_id,
        payload.loaders.as_ref().and_then(|l| l.first().cloned()),
        payload.game_versions.as_ref().and_then(|g| g.first().cloned()),
    )
    .await;
    Ok(())
}

async fn pin_for_matching_versions(
    state: &State,
    pack_id: Uuid,
    mod_id: Uuid,
    payload: &InstallContentPayload,
) -> Result<()> {
    let Some(supported) = payload.game_versions.as_ref().filter(|l| !l.is_empty()) else {
        return Ok(());
    };

    let source = mod_source_from_payload(payload);
    let project_key = resolution::project_key_of(&source);
    let resolved = ResolvedVersion::from_payload(payload);

    let subscribers = subscribers::of_pack(state, pack_id).await;
    let mut pinned: Vec<String> = Vec::new();

    for (mc_version, loader) in subscribers::contexts(&subscribers) {
        if !supported.contains(&mc_version) {
            continue;
        }

        if !pinned.contains(&mc_version) {
            state
                .sync_pack_manager
                .set_mod_version_override(
                    pack_id,
                    mod_id,
                    &mc_version,
                    Some(VersionOverride::Pin {
                        version_id: payload.version_id.clone(),
                    }),
                )
                .await?;
            pinned.push(mc_version.clone());
        }

        if let Some(key) = project_key.as_deref() {
            state
                .sync_pack_manager
                .set_mod_resolution(pack_id, key, &mc_version, loader.as_str(), &resolved)
                .await?;
        }
    }

    if !pinned.is_empty() {
        info!(
            "Pinned {} for {} in sync pack {}",
            payload.version_id,
            pinned.join(", "),
            pack_id
        );
    }
    Ok(())
}

pub async fn add_dependencies(
    pack_id: Uuid,
    platform: &ModPlatform,
    project_id: &str,
    version_id: &str,
    loader: Option<String>,
    game_version: Option<String>,
) {
    let (Some(loader), Some(game_version)) = (loader, game_version) else {
        return;
    };

    let Some(version) = version_details(platform, project_id, version_id).await else {
        return;
    };
    if version.dependencies.is_empty() {
        return;
    }

    let resolved = resolve_required_dependencies(
        platform,
        &version.dependencies,
        &version.date_published,
        &DependencyTarget {
            loader,
            game_version,
        },
        DEPENDENCY_DEPTH,
    )
    .await;
    if resolved.is_empty() {
        return;
    }

    let Ok(state) = State::get().await else { return };
    let Ok(Some(pack)) = state.sync_pack_manager.get_pack(pack_id).await else {
        return;
    };
    let existing = pack.plain_mods();

    let to_add: Vec<Mod> = resolved
        .into_iter()
        .filter(|d| find_mod_by_project_id(&existing, &d.project_id).is_none())
        .filter_map(|d| {
            mod_from_unified_version(&d.version).inspect(|_| {
                info!("Adding dependency {} to sync pack {}", d.project_id, pack_id);
            })
        })
        .collect();

    if to_add.is_empty() {
        return;
    }

    if let Err(e) = state.sync_pack_manager.add_mods(pack_id, &to_add).await {
        warn!("Could not add dependencies to sync pack {}: {}", pack_id, e);
    }
}
