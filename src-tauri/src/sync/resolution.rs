use crate::error::{AppError, Result};
use crate::integrations::unified_mod::{
    self, ModPlatform, UnifiedModVersionsParams, UnifiedVersion,
};
use crate::integrations::{curseforge, modrinth};
use crate::commands::content_command::InstallContentPayload;
use crate::state::profile_state::{mod_platform_ids, mod_project_key, Mod, ModLoader, ModSource};
use crate::state::content_cache_state::CacheBehaviour;
use crate::state::state_manager::State;
use crate::state::sync_pack_state::SyncPackManager;
use crate::sync::model::{SyncPack, SyncPackModEntry, VersionOverride};
use chrono::Utc;
use futures::StreamExt;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResolvedVersion {
    pub version_id: String,
    pub version_name: Option<String>,
    pub filename: String,
    pub download_url: String,
    pub sha1: Option<String>,
    pub file_size: Option<i64>,
    pub resolved_at: i64,
}

impl ResolvedVersion {
    fn new(
        version_id: String,
        version_name: Option<String>,
        filename: String,
        download_url: String,
        sha1: Option<String>,
        file_size: Option<i64>,
    ) -> Self {
        Self {
            version_id,
            version_name,
            filename,
            download_url,
            sha1,
            file_size,
            resolved_at: Utc::now().timestamp_millis(),
        }
    }

    pub fn from_unified(version: UnifiedVersion) -> Result<Self> {
        let file = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .ok_or_else(|| {
                AppError::Other(format!("Version {} carries no downloadable file", version.id))
            })?;

        Ok(Self::new(
            version.id.clone(),
            Some(version.version_number.clone()),
            file.filename.clone(),
            file.url.clone(),
            file.hashes.get("sha1").cloned(),
            i64::try_from(file.size).ok(),
        ))
    }

    pub fn from_mod(info: &Mod) -> Option<Self> {
        let (version_id, filename, download_url, sha1) = match &info.source {
            ModSource::Modrinth {
                version_id,
                file_name,
                download_url,
                file_hash_sha1,
                ..
            } => (
                version_id.clone(),
                file_name.clone(),
                download_url.clone(),
                file_hash_sha1.clone(),
            ),
            ModSource::CurseForge {
                file_id,
                file_name,
                download_url,
                file_hash_sha1,
                ..
            } => (
                file_id.clone(),
                file_name.clone(),
                download_url.clone(),
                file_hash_sha1.clone(),
            ),
            _ => return None,
        };

        Some(Self::new(
            version_id,
            info.version.clone(),
            filename,
            download_url,
            sha1,
            None,
        ))
    }

    pub fn from_payload(payload: &InstallContentPayload) -> Self {
        Self::new(
            payload.version_id.clone(),
            payload.version_number.clone(),
            payload.file_name.clone(),
            payload.download_url.clone(),
            payload.file_hash_sha1.clone(),
            None,
        )
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatrixStatus {
    AutoResolved,
    OverridePinned,
    Disabled,
    Unresolved,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPackModMatrixRow {
    pub mc_version: String,
    pub loader: String,
    pub status: MatrixStatus,
    pub resolved_version_id: Option<String>,
    pub resolved_version_name: Option<String>,
    pub resolved_filename: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPackModMatrix {
    pub mod_id: Uuid,
    pub display_name: String,
    pub project_key: Option<String>,
    pub resolvable: bool,
    pub rows: Vec<SyncPackModMatrixRow>,
}

pub fn project_key_of(source: &ModSource) -> Option<String> {
    mod_project_key(source).map(|(platform, id)| format!("{}:{}", platform, id))
}

pub fn platform_of(source: &ModSource) -> Option<ModPlatform> {
    mod_platform_ids(source).map(|(platform, _, _)| platform)
}

fn current_version_id(source: &ModSource) -> Option<String> {
    mod_platform_ids(source).map(|(_, _, version_id)| version_id)
}

fn pick_best(
    versions: Vec<UnifiedVersion>,
    mc_version: &str,
    loader: ModLoader,
) -> Option<UnifiedVersion> {
    let loader_str = loader.as_str();
    versions
        .into_iter()
        .filter(|v| v.game_versions.iter().any(|g| g == mc_version))
        .filter(|v| {
            v.loaders.is_empty() || v.loaders.iter().any(|l| l.eq_ignore_ascii_case(loader_str))
        })
        .filter(|v| !v.files.is_empty())
        .max_by(|a, b| a.date_published.cmp(&b.date_published))
}

pub async fn resolve_online(
    source: &ModSource,
    mc_version: &str,
    loader: ModLoader,
) -> Result<ResolvedVersion> {
    let platform = platform_of(source).ok_or_else(|| {
        AppError::Other("Only Modrinth and CurseForge mods can be resolved".to_string())
    })?;
    let (_, project_id) = mod_project_key(source)
        .ok_or_else(|| AppError::Other("The mod carries no project id".to_string()))?;

    let loaders = Some(vec![loader.as_str().to_string()]);
    let game_versions = Some(vec![mc_version.to_string()]);

    let candidates: Vec<UnifiedVersion> = match platform {
        ModPlatform::Modrinth => {
            let state = State::get().await?;
            state
                .content_cache
                .get_modrinth_project_versions(
                    project_id,
                    loaders,
                    game_versions,
                    CacheBehaviour::StaleWhileRevalidate,
                )
                .await?
                .into_iter()
                .map(UnifiedVersion::from)
                .collect()
        }
        ModPlatform::CurseForge => {
            unified_mod::get_mod_versions_unified(UnifiedModVersionsParams {
                source: platform.clone(),
                project_id: project_id.to_string(),
                loaders,
                game_versions,
                limit: Some(50),
                offset: None,
            })
            .await?
            .versions
        }
    };

    let best = pick_best(candidates, mc_version, loader).ok_or_else(|| {
        AppError::Other(format!(
            "No {} version of project {} is compatible with {} / {}",
            platform_label(&platform),
            project_id,
            mc_version,
            loader.as_str()
        ))
    })?;

    ResolvedVersion::from_unified(best)
}

pub async fn resolve_version_by_id(source: &ModSource, version_id: &str) -> Result<ResolvedVersion> {
    match source {
        ModSource::Modrinth { .. } => {
            let version = modrinth::get_version_details(version_id.to_string()).await?;
            ResolvedVersion::from_unified(UnifiedVersion::from(version))
        }
        ModSource::CurseForge { project_id, .. } => {
            let mod_id = project_id.parse::<u32>().map_err(|_| {
                AppError::Other(format!("Invalid CurseForge project id: {}", project_id))
            })?;
            let file_id = version_id.parse::<u32>().map_err(|_| {
                AppError::Other(format!("Invalid CurseForge file id: {}", version_id))
            })?;
            let file = curseforge::get_file_details(mod_id, file_id).await?;
            ResolvedVersion::from_unified(UnifiedVersion::from(file))
        }
        _ => Err(AppError::Other(
            "Only Modrinth and CurseForge mods carry pinnable versions".to_string(),
        )),
    }
}

fn platform_label(platform: &ModPlatform) -> &'static str {
    match platform {
        ModPlatform::Modrinth => "Modrinth",
        ModPlatform::CurseForge => "CurseForge",
    }
}

pub fn apply_resolution(
    base: &Mod,
    resolved: &ResolvedVersion,
    mc_version: &str,
    loader: ModLoader,
) -> Mod {
    let mut out = base.clone();

    match &mut out.source {
        ModSource::Modrinth {
            version_id,
            file_name,
            download_url,
            file_hash_sha1,
            ..
        } => {
            *version_id = resolved.version_id.clone();
            *file_name = resolved.filename.clone();
            *download_url = resolved.download_url.clone();
            *file_hash_sha1 = resolved.sha1.clone();
        }
        ModSource::CurseForge {
            file_id,
            file_name,
            download_url,
            file_hash_sha1,
            ..
        } => {
            *file_id = resolved.version_id.clone();
            *file_name = resolved.filename.clone();
            *download_url = resolved.download_url.clone();
            *file_hash_sha1 = resolved.sha1.clone();
        }
        _ => {}
    }

    out.version = resolved
        .version_name
        .clone()
        .or_else(|| base.version.clone());
    out.file_name_override = None;
    out.game_versions = Some(vec![mc_version.to_string()]);
    out.associated_loader = Some(loader);
    out
}

pub struct PackModResolution {
    pub mods: Vec<Mod>,
    pub warnings: Vec<String>,
}

const RESOLVE_CONCURRENCY: usize = 8;
const RESOLUTION_TTL_MS: i64 = 24 * 60 * 60 * 1000;

fn is_fresh(resolved: &ResolvedVersion) -> bool {
    Utc::now().timestamp_millis() - resolved.resolved_at < RESOLUTION_TTL_MS
}

enum Plan {
    Ready(Mod),
    Skip,
    Online {
        info: Mod,
        key: String,
        pinned: Option<String>,
        label: String,
        stale: Option<ResolvedVersion>,
    },
}

fn plan_entry(
    entry: &SyncPackModEntry,
    mc_version: &str,
    loader: ModLoader,
    cache: &ResolutionCache,
) -> Plan {
    let Some(key) = project_key_of(&entry.info.source) else {
        return Plan::Ready(entry.info.clone());
    };

    let pinned = match entry.override_for(mc_version) {
        Some(VersionOverride::Disabled) => {
            debug!(
                "Sync pack mod '{}' is disabled for {} by an override",
                entry.info.id, mc_version
            );
            return Plan::Skip;
        }
        Some(VersionOverride::Pin { version_id }) => Some(version_id.clone()),
        None => None,
    };

    let cached = cached_for(cache, &key, mc_version, loader);

    if let Some(version_id) = &pinned {
        if let Some(hit) = cached.filter(|c| &c.version_id == version_id) {
            return Plan::Ready(apply_resolution(&entry.info, hit, mc_version, loader));
        }
        if current_version_id(&entry.info.source).as_deref() == Some(version_id.as_str()) {
            if let Some(native) = ResolvedVersion::from_mod(&entry.info) {
                return Plan::Ready(apply_resolution(&entry.info, &native, mc_version, loader));
            }
        }
        return Plan::Online {
            info: entry.info.clone(),
            key,
            pinned,
            label: label_of(entry),
            stale: None,
        };
    }

    if let Some(hit) = cached {
        if is_fresh(hit) {
            return Plan::Ready(apply_resolution(&entry.info, hit, mc_version, loader));
        }
    }

    Plan::Online {
        info: entry.info.clone(),
        key,
        pinned,
        label: label_of(entry),
        stale: cached.cloned(),
    }
}

fn label_of(entry: &SyncPackModEntry) -> String {
    entry
        .info
        .display_name
        .clone()
        .unwrap_or_else(|| entry.info.id.to_string())
}

pub async fn resolve_pack_mods(
    manager: &SyncPackManager,
    pack: &SyncPack,
    mc_version: &str,
    loader: ModLoader,
) -> PackModResolution {
    let mut out = PackModResolution {
        mods: Vec::new(),
        warnings: Vec::new(),
    };
    let cache = manager
        .get_mod_resolutions(pack.id)
        .await
        .unwrap_or_default();

    let mut slots: Vec<Option<Mod>> = Vec::new();
    let mut pending: Vec<(usize, Mod, String, Option<String>, String, Option<ResolvedVersion>)> =
        Vec::new();

    for entry in pack.mods.iter().filter(|e| e.info.enabled) {
        match plan_entry(entry, mc_version, loader, &cache) {
            Plan::Ready(m) => slots.push(Some(m)),
            Plan::Skip => {}
            Plan::Online {
                info,
                key,
                pinned,
                label,
                stale,
            } => {
                slots.push(None);
                pending.push((slots.len() - 1, info, key, pinned, label, stale));
            }
        }
    }

    if !pending.is_empty() {
        debug!(
            "Resolving {} sync pack mod(s) of '{}' online for {} / {}",
            pending.len(),
            pack.name,
            mc_version,
            loader.as_str()
        );

        let mc_version = mc_version.to_string();
        let resolved: Vec<(
            usize,
            Mod,
            String,
            String,
            Option<ResolvedVersion>,
            Result<ResolvedVersion>,
        )> = futures::stream::iter(pending.into_iter().map(
            |(slot, info, key, pinned, label, stale)| {
                let mc_version = mc_version.clone();
                async move {
                    let outcome = match &pinned {
                        Some(version_id) => {
                            resolve_version_by_id(&info.source, version_id).await
                        }
                        None => resolve_online(&info.source, &mc_version, loader).await,
                    };
                    (slot, info, key, label, stale, outcome)
                }
            },
        ))
            .buffer_unordered(RESOLVE_CONCURRENCY)
            .collect()
            .await;

        let mut writes: Vec<(String, String, String, ResolvedVersion)> = Vec::new();
        for (slot, info, key, label, stale, outcome) in resolved {
            match outcome {
                Ok(version) => {
                    slots[slot] = Some(apply_resolution(&info, &version, &mc_version, loader));
                    writes.push((
                        key,
                        mc_version.clone(),
                        loader.as_str().to_string(),
                        version,
                    ));
                }
                Err(e) => {
                    if let Some(stale) = stale {
                        warn!(
                            "Could not refresh sync pack mod '{}' for {} / {}, keeping the cached version: {}",
                            label,
                            mc_version,
                            loader.as_str(),
                            e
                        );
                        slots[slot] =
                            Some(apply_resolution(&info, &stale, &mc_version, loader));
                        continue;
                    }

                    warn!(
                        "Could not resolve sync pack mod '{}' for {} / {}: {}",
                        label,
                        mc_version,
                        loader.as_str(),
                        e
                    );
                    out.warnings.push(format!(
                        "'{}' could not be resolved for {}: {}",
                        label, mc_version, e
                    ));
                }
            }
        }

        if let Err(e) = manager.set_mod_resolutions(pack.id, &writes).await {
            warn!(
                "Could not cache the resolved versions of sync pack '{}': {}",
                pack.name, e
            );
        }
    }

    out.mods = slots.into_iter().flatten().collect();
    out
}

pub fn matrix_row(
    entry: &SyncPackModEntry,
    mc_version: &str,
    loader: ModLoader,
    cached: Option<&ResolvedVersion>,
) -> SyncPackModMatrixRow {
    let mut row = SyncPackModMatrixRow {
        mc_version: mc_version.to_string(),
        loader: loader.as_str().to_string(),
        status: MatrixStatus::Unresolved,
        resolved_version_id: None,
        resolved_version_name: None,
        resolved_filename: None,
    };

    match entry.override_for(mc_version) {
        Some(VersionOverride::Disabled) => {
            row.status = MatrixStatus::Disabled;
            return row;
        }
        Some(VersionOverride::Pin { version_id }) => {
            row.status = MatrixStatus::OverridePinned;
            row.resolved_version_id = Some(version_id.clone());
            match cached.filter(|c| &c.version_id == version_id) {
                Some(cached) => {
                    row.resolved_version_name = cached.version_name.clone();
                    row.resolved_filename = Some(cached.filename.clone());
                }
                None => {
                    let own = current_version_id(&entry.info.source);
                    if own.as_deref() == Some(version_id.as_str()) {
                        row.resolved_version_name = entry.info.version.clone();
                        row.resolved_filename =
                            crate::state::profile_state::get_profile_mod_filename(
                                &entry.info.source,
                            )
                            .ok();
                    }
                    if row.resolved_version_name.is_none() {
                        row.resolved_version_name = Some(version_id.clone());
                    }
                }
            }
            return row;
        }
        None => {}
    }

    if let Some(cached) = cached {
        row.status = MatrixStatus::AutoResolved;
        row.resolved_version_id = Some(cached.version_id.clone());
        row.resolved_version_name = cached.version_name.clone();
        row.resolved_filename = Some(cached.filename.clone());
    }

    row
}

pub type ResolutionCache = std::collections::HashMap<(String, String, String), ResolvedVersion>;

fn cached_for<'a>(
    cache: &'a ResolutionCache,
    project_key: &str,
    mc_version: &str,
    loader: ModLoader,
) -> Option<&'a ResolvedVersion> {
    cache.get(&(
        project_key.to_string(),
        mc_version.to_string(),
        loader.as_str().to_string(),
    ))
}

pub fn matrix_rows(
    entry: &SyncPackModEntry,
    project_key: Option<&str>,
    contexts: &[(String, ModLoader)],
    cache: &ResolutionCache,
) -> Vec<SyncPackModMatrixRow> {
    contexts
        .iter()
        .map(|(mc_version, loader)| {
            let cached =
                project_key.and_then(|key| cached_for(cache, key, mc_version, *loader));
            matrix_row(entry, mc_version, *loader, cached)
        })
        .collect()
}

pub fn matrix_for_pack(
    pack: &SyncPack,
    contexts: &[(String, ModLoader)],
    cache: &ResolutionCache,
) -> Vec<SyncPackModMatrix> {
    pack.mods
        .iter()
        .map(|entry| {
            let project_key = project_key_of(&entry.info.source);
            SyncPackModMatrix {
                mod_id: entry.info.id,
                display_name: entry
                    .info
                    .display_name
                    .clone()
                    .unwrap_or_else(|| entry.info.id.to_string()),
                rows: matrix_rows(entry, project_key.as_deref(), contexts, cache),
                resolvable: project_key.is_some(),
                project_key,
            }
        })
        .collect()
}

pub async fn refresh_resolutions(
    manager: &SyncPackManager,
    pack_id: Uuid,
    entry: &SyncPackModEntry,
    project_key: &str,
    contexts: &[(String, ModLoader)],
) -> Result<Vec<SyncPackModMatrixRow>> {
    let mut errors: Vec<String> = Vec::new();

    for (mc_version, loader) in contexts {
        let pinned = match entry.override_for(mc_version) {
            Some(VersionOverride::Disabled) => continue,
            Some(VersionOverride::Pin { version_id }) => Some(version_id.clone()),
            None => None,
        };

        let resolved = match &pinned {
            Some(version_id) => resolve_version_by_id(&entry.info.source, version_id).await,
            None => resolve_online(&entry.info.source, mc_version, *loader).await,
        };

        match resolved {
            Ok(resolved) => {
                manager
                    .set_mod_resolution(pack_id, project_key, mc_version, loader.as_str(), &resolved)
                    .await?;
            }
            Err(e) => {
                warn!(
                    "Could not resolve sync pack mod {} for {} / {}: {}",
                    entry.info.id,
                    mc_version,
                    loader.as_str(),
                    e
                );
                errors.push(format!("{} / {}: {}", mc_version, loader.as_str(), e));
            }
        }
    }

    if !contexts.is_empty() && errors.len() == contexts.len() {
        return Err(AppError::Other(errors.join("; ")));
    }

    let cache = manager.get_mod_resolutions(pack_id).await?;
    Ok(matrix_rows(entry, Some(project_key), contexts, &cache))
}
