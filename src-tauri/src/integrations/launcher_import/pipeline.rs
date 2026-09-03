use super::control::{self, CancelGuard};
use super::copy;
use super::model::*;
use super::preview;
use super::resolve::{self, LocalJar, ResolvedMods};
use super::staging::StagingDir;
use crate::error::{AppError, Result};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{
    default_profile_path, MemorySettings, Mod, ModPackInfo, ModPackSource, Profile, ProfileBanner,
    ProfileSettings, ProfileState as ProfileLifecycle,
};
use crate::state::State;
use crate::utils::disk_space_utils::DiskSpaceUtils;
use crate::utils::import_safety::{safe_file_component, strip_profile_flags, ImportSecurityReport};
use chrono::Utc;
use fs4::tokio::AsyncFileExt;
use log::{info, warn};
use sanitize_filename::sanitize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use uuid::Uuid;

const MIN_MEMORY_MB: u32 = 512;
const MAX_MEMORY_MB: u32 = 32768;

const PHASE_READ: f64 = 0.01;
const PHASE_PLAN: f64 = 0.05;
const PHASE_IDENTIFY: f64 = 0.08;
const PHASE_COPY: (f64, f64) = (0.38, 0.82);
const PHASE_MODS: f64 = 0.85;
const PHASE_COMMIT: f64 = 0.92;

pub struct ImportRequest {
    pub launcher: ExternalLauncher,
    pub root: PathBuf,
    pub instance_dir: PathBuf,
    pub selection: ImportSelection,
    pub name_override: Option<String>,
    pub group_override: Option<String>,
    pub event_id: Option<Uuid>,
}

fn override_or(value: Option<&String>, fallback: &str) -> String {
    value
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

impl ImportRequest {
    fn name_for(&self, instance: &ExternalInstance) -> String {
        override_or(self.name_override.as_ref(), &instance.reference.name)
    }

    fn group_for(&self) -> String {
        override_or(self.group_override.as_ref(), self.launcher.suggested_group())
    }
}

struct Progress {
    state: Arc<State>,
    event_id: Option<Uuid>,
}

impl Progress {
    async fn emit(&self, progress: f64, message: impl Into<String>) {
        let Some(event_id) = self.event_id else {
            return;
        };

        let _ = self
            .state
            .event_state
            .emit(EventPayload {
                event_id,
                event_type: EventType::TaskProgress,
                target_id: None,
                message: message.into(),
                progress: Some(progress),
                error: None,
            })
            .await;
    }
}

fn clamp_memory(memory: Option<(u32, u32)>) -> Option<MemorySettings> {
    let (min, max) = memory?;
    let clamp = |value: u32| value.clamp(MIN_MEMORY_MB, MAX_MEMORY_MB);
    let min = clamp(min);

    Some(MemorySettings {
        min,
        max: clamp(max).max(min),
    })
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<()> {
    if control::is_cancelled(cancel) {
        return Err(AppError::Other("Import cancelled".to_string()));
    }
    Ok(())
}

async fn world_is_open(world_dir: &Path) -> bool {
    let lock_path = world_dir.join("session.lock");
    if !tokio::fs::try_exists(&lock_path).await.unwrap_or(false) {
        return false;
    }

    let Ok(file) = tokio::fs::OpenOptions::new()
        .write(true)
        .create(false)
        .open(&lock_path)
        .await
    else {
        return true;
    };

    file.try_lock_exclusive().is_err()
}

async fn ensure_not_running(game_dir: &Path) -> Result<()> {
    let Ok(mut entries) = tokio::fs::read_dir(game_dir.join("saves")).await else {
        return Ok(());
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let world = entry.path();
        if world.is_dir() && world_is_open(&world).await {
            return Err(AppError::Other(
                "This instance is currently open in its launcher. Close it and try again."
                    .to_string(),
            ));
        }
    }

    Ok(())
}

async fn unique_path_segment(name: &str) -> String {
    let sanitized = sanitize(name);
    let base = if sanitized.trim().is_empty() {
        format!("imported-instance-{}", Utc::now().timestamp_millis())
    } else {
        sanitized
    };

    let profiles_dir = default_profile_path();
    let mut candidate = base.clone();
    let mut counter = 1;

    while tokio::fs::try_exists(profiles_dir.join(&candidate))
        .await
        .unwrap_or(false)
    {
        candidate = format!("{}-{}", base, counter);
        counter += 1;
    }

    candidate
}

fn modpack_info_from(instance: &ExternalInstance) -> Option<ModPackInfo> {
    let source = match instance.managed_pack.as_ref()? {
        ManagedPackRef::Modrinth {
            project_id,
            version_id,
        } => ModPackSource::Modrinth {
            project_id: project_id.clone(),
            version_id: version_id.clone()?,
        },
        ManagedPackRef::CurseForge {
            project_id,
            file_id,
        } => ModPackSource::CurseForge {
            project_id: *project_id,
            file_id: (*file_id)?,
        },
    };

    Some(ModPackInfo {
        source,
        file_hash: None,
    })
}

async fn copy_local_jars(staging: &Path, local: &[LocalJar], cancel: &AtomicBool) -> Result<usize> {
    if local.is_empty() {
        return Ok(0);
    }

    let mods_dir = staging.join("mods");
    tokio::fs::create_dir_all(&mods_dir)
        .await
        .map_err(AppError::Io)?;

    let mut copied = 0;
    let mut seen: HashSet<String> = HashSet::new();

    for jar in local {
        if control::is_cancelled(cancel) {
            return Err(AppError::Other("Import cancelled".to_string()));
        }

        let Ok(file_name) = safe_file_component(&jar.file_name) else {
            continue;
        };
        if !seen.insert(file_name.to_ascii_lowercase()) {
            continue;
        }

        let target_name = if jar.enabled {
            file_name
        } else {
            format!("{}.disabled", file_name)
        };

        match tokio::fs::copy(&jar.source_path, mods_dir.join(&target_name)).await {
            Ok(_) => copied += 1,
            Err(e) => warn!("Could not copy local jar '{}': {}", target_name, e),
        }
    }

    Ok(copied)
}

struct ProfileDraft {
    instance: ExternalInstance,
    game_version: String,
    path_segment: String,
    banner: Option<ProfileBanner>,
    managed: Vec<Mod>,
    local_copied: usize,
}

fn build_profile(request: &ImportRequest, draft: ProfileDraft) -> Result<Profile> {
    let ProfileDraft {
        instance,
        game_version,
        path_segment,
        banner,
        managed,
        local_copied,
    } = draft;

    let defaults = ProfileSettings::default();

    let mut profile = Profile {
        id: Uuid::new_v4(),
        name: request.name_for(&instance),
        path: path_segment,
        game_version,
        loader: instance.loader(),
        loader_version: instance.reference.loader_version.clone(),
        created: Utc::now(),
        last_played: None,
        settings: ProfileSettings {
            memory: clamp_memory(instance.memory_mb).unwrap_or(defaults.memory.clone()),
            ..ProfileSettings::default()
        },
        state: ProfileLifecycle::NotInstalled,
        modpack_info: modpack_info_from(&instance),
        mods: managed,
        selected_norisk_pack_id: None,
        disabled_norisk_mods_detailed: Default::default(),
        source_standard_profile_id: None,
        group: Some(request.group_for()),
        use_shared_minecraft_folder: false,
        is_standard_version: false,
        description: None,
        banner,
        background: None,
        norisk_information: None,
        preferred_account_id: None,
        playtime_seconds: 0,
        sync_pack_ids: Vec::new(),
        extra: Default::default(),
    };

    strip_profile_flags(&mut profile, &mut ImportSecurityReport::default());

    let marker = ImportedFrom {
        kind: IMPORTED_FROM_KIND.to_string(),
        launcher: request.launcher.as_str().to_string(),
        launcher_display_name: request.launcher.display_name().to_string(),
        instance_name: instance.reference.name.clone(),
        instance_dir: request.instance_dir.display().to_string(),
        imported_at: Utc::now(),
        schema: 1,
        identified_mods: profile.mods.len(),
        local_mods: local_copied,
    };

    profile.extra.insert(
        IMPORTED_FROM_KEY.to_string(),
        serde_json::to_value(&marker).map_err(AppError::Json)?,
    );

    Ok(profile)
}

pub async fn import_instance(request: ImportRequest) -> Result<Uuid> {
    let state = State::get().await?;
    let progress = Progress {
        state: state.clone(),
        event_id: request.event_id,
    };
    let guard: CancelGuard = control::register(request.event_id);
    let cancel = guard.flag();

    progress.emit(PHASE_READ, "Reading instance...").await;

    let instance =
        preview::read_instance(request.launcher, &request.root, &request.instance_dir).await?;

    let game_version = instance.reference.game_version.clone().ok_or_else(|| {
        AppError::Other(
            "This instance does not name a Minecraft version, so it cannot be imported."
                .to_string(),
        )
    })?;

    ensure_not_running(&instance.game_dir).await?;
    ensure_not_cancelled(&cancel)?;

    progress.emit(PHASE_PLAN, "Planning the copy...").await;

    let plan = copy::build_plan(
        &instance.game_dir,
        &request.selection,
        &ImportSelection::default(),
    )
    .await;

    let profiles_dir = default_profile_path();
    DiskSpaceUtils::ensure_space_for_download(&profiles_dir, plan.total_bytes, 0.1).await?;

    progress
        .emit(
            PHASE_IDENTIFY,
            format!("Identifying mods of '{}'...", instance.reference.name),
        )
        .await;

    let resolved = if request.selection.mods {
        resolve::resolve_instance_mods(&instance, &game_version).await
    } else {
        Arc::new(ResolvedMods::default())
    };

    ensure_not_cancelled(&cancel)?;

    progress
        .emit(
            PHASE_COPY.0,
            format!(
                "{} mods identified, {} kept as local files",
                resolved.managed.len(),
                resolved.local.len()
            ),
        )
        .await;

    let mut staging = StagingDir::create(&profiles_dir).await?;

    copy::copy_planned(&plan, staging.path(), &cancel, |done, total| {
        let progress = &progress;
        let ratio = if total == 0 {
            1.0
        } else {
            done as f64 / total as f64
        };
        let value = PHASE_COPY.0 + (PHASE_COPY.1 - PHASE_COPY.0) * ratio;
        async move {
            progress.emit(value, "Copying instance files...").await;
        }
    })
    .await?;

    progress.emit(PHASE_MODS, "Adding mods...").await;

    let local_copied = copy_local_jars(staging.path(), &resolved.local, &cancel).await?;

    if request.selection.mods {
        let seeded = resolve::seed_mod_cache(&resolved.managed, &resolved.jars).await;
        info!("Seeded {} jars into the shared mod cache", seeded);
    }

    progress.emit(PHASE_COMMIT, "Creating the profile...").await;

    let banner = match instance.icon.as_ref() {
        Some(icon) => icon.store_in(staging.path()).await,
        None => None,
    };

    let path_segment = unique_path_segment(&request.name_for(&instance)).await;
    let profile = build_profile(
        &request,
        ProfileDraft {
            instance,
            game_version,
            path_segment,
            banner,
            managed: resolved.managed.clone(),
            local_copied,
        },
    )?;

    let final_path = profiles_dir.join(&profile.path);
    staging.commit_to(&final_path).await?;

    let name = profile.name.clone();
    let profile_id = match state.profile_manager.create_profile(profile).await {
        Ok(id) => id,
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&final_path).await;
            return Err(e);
        }
    };

    progress.emit(1.0, format!("Imported '{}'", name)).await;
    info!(
        "Imported '{}' from {} as profile {}",
        name,
        request.launcher.display_name(),
        profile_id
    );

    Ok(profile_id)
}
