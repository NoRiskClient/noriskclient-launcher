use crate::integrations::{curseforge, modrinth, unified_mod};
use crate::state::profile_state::{Mod, ModLoader, ModSource};
use crate::utils::hash_utils;
use dashmap::DashMap;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

pub const MODRINTH_HASH_BATCH: usize = 200;
pub const CURSEFORGE_FILE_BATCH: usize = 200;
const HASHING_CONCURRENCY: usize = 8;

static RESOLVED_BY_SHA1: Lazy<DashMap<String, Option<Mod>>> = Lazy::new(DashMap::new);

fn fresh_copy(entry: &Mod) -> Mod {
    let mut copy = entry.clone();
    copy.id = Uuid::new_v4();
    copy
}

pub fn mod_from_modrinth_version(
    version: &modrinth::ModrinthVersion,
    sha1: Option<String>,
) -> Option<Mod> {
    let file = version
        .files
        .iter()
        .find(|entry| entry.primary)
        .or_else(|| version.files.first())?;

    Some(Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: version.project_id.clone(),
            version_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1.or_else(|| file.hashes.sha1.clone()),
        },
        enabled: true,
        display_name: Some(version.name.clone()),
        version: Some(version.version_number.clone()),
        game_versions: Some(version.game_versions.clone()),
        file_name_override: None,
        associated_loader: version
            .loaders
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    })
}

pub fn mod_from_curseforge_file(file: &curseforge::CurseForgeFile) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::CurseForge {
            project_id: file.mod_id.to_string(),
            file_id: file.id.to_string(),
            file_name: file.file_name.clone(),
            download_url: file.download_url.clone(),
            file_hash_sha1: file
                .hashes
                .iter()
                .find(|hash| hash.algo == 1)
                .map(|hash| hash.value.clone()),
            file_fingerprint: Some(file.file_fingerprint),
        },
        enabled: true,
        display_name: Some(file.display_name.clone()),
        version: None,
        game_versions: Some(file.game_versions.clone()),
        file_name_override: None,
        associated_loader: unified_mod::extract_loaders_from_game_versions(&file.game_versions)
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    }
}

#[derive(Debug, Clone)]
pub struct JarIdentity {
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub fingerprint: Option<u64>,
    pub resolved: Option<Mod>,
}

impl JarIdentity {
    fn label(&self) -> String {
        self.path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| self.path.display().to_string())
    }
}

pub fn chunk_unique<T: Eq + Hash + Clone>(values: impl IntoIterator<Item = T>, size: usize) -> Vec<Vec<T>> {
    let mut seen = HashSet::new();
    let unique: Vec<T> = values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect();

    unique
        .chunks(size.max(1))
        .map(|chunk| chunk.to_vec())
        .collect()
}

async fn hash_jars(paths: &[PathBuf]) -> Vec<JarIdentity> {
    let semaphore = Arc::new(Semaphore::new(HASHING_CONCURRENCY));

    let tasks = paths.iter().cloned().map(|path| {
        let semaphore = semaphore.clone();
        async move {
            let _permit = semaphore.acquire_owned().await.ok();
            let sha1 = hash_utils::calculate_sha1_from_file(&path).await.ok();
            JarIdentity {
                path,
                sha1,
                fingerprint: None,
                resolved: None,
            }
        }
    });

    futures::future::join_all(tasks).await
}

async fn fingerprint_unresolved(items: &mut [JarIdentity]) {
    let semaphore = Arc::new(Semaphore::new(HASHING_CONCURRENCY));

    let tasks = items
        .iter()
        .filter(|item| item.resolved.is_none() && item.fingerprint.is_none())
        .map(|item| item.path.clone())
        .map(|path| {
            let semaphore = semaphore.clone();
            async move {
                let _permit = semaphore.acquire_owned().await.ok();
                let fingerprint = hash_utils::calculate_curseforge_fingerprint(&path).await.ok();
                (path, fingerprint)
            }
        });

    let computed: HashMap<PathBuf, Option<u64>> = futures::future::join_all(tasks).await.into_iter().collect();

    for item in items.iter_mut() {
        if let Some(fingerprint) = computed.get(&item.path) {
            item.fingerprint = *fingerprint;
        }
    }
}

fn apply_cached(items: &mut [JarIdentity]) -> usize {
    let mut hits = 0;
    for item in items.iter_mut() {
        let Some(sha1) = item.sha1.as_ref() else {
            continue;
        };
        if let Some(cached) = RESOLVED_BY_SHA1.get(sha1) {
            item.resolved = cached.as_ref().map(fresh_copy);
            hits += 1;
        }
    }
    hits
}

fn remember(items: &[JarIdentity], lookups_complete: bool) {
    for item in items {
        if item.resolved.is_none() && !lookups_complete {
            continue;
        }
        if let Some(sha1) = item.sha1.as_ref() {
            RESOLVED_BY_SHA1.insert(sha1.clone(), item.resolved.clone());
        }
    }
}

async fn resolve_with_modrinth(items: &mut [JarIdentity]) -> bool {
    let hashes = items.iter().filter_map(|item| item.sha1.clone());
    let mut versions: HashMap<String, modrinth::ModrinthVersion> = HashMap::new();
    let mut complete = true;

    for chunk in chunk_unique(hashes, MODRINTH_HASH_BATCH) {
        match modrinth::get_versions_by_hashes(chunk, "sha1").await {
            Ok(found) => versions.extend(found),
            Err(e) => {
                warn!("Modrinth hash lookup failed for one batch: {}", e);
                complete = false;
            }
        }
    }

    if versions.is_empty() {
        return complete;
    }

    for item in items.iter_mut() {
        let Some(sha1) = item.sha1.clone() else {
            continue;
        };
        let Some(version) = versions.get(&sha1) else {
            continue;
        };
        if let Some(entry) = mod_from_modrinth_version(version, Some(sha1)) {
            info!(
                "Identified '{}' as Modrinth {}/{}",
                item.label(),
                version.project_id,
                version.id
            );
            item.resolved = Some(entry);
        }
    }

    complete
}

async fn resolve_with_curseforge(items: &mut [JarIdentity]) -> bool {
    let fingerprints: Vec<u64> = items
        .iter()
        .filter(|item| item.resolved.is_none())
        .filter_map(|item| item.fingerprint)
        .collect();

    if fingerprints.is_empty() {
        return true;
    }

    let matches = match curseforge::fingerprint_matches(fingerprints).await {
        Ok(matches) => matches,
        Err(e) => {
            warn!("CurseForge fingerprint lookup failed: {}", e);
            return false;
        }
    };

    if matches.is_empty() {
        return true;
    }

    let mut complete = true;

    let mut files: HashMap<u32, curseforge::CurseForgeFile> = HashMap::new();
    let file_ids = matches.values().map(|(_, file_id)| *file_id);

    for chunk in chunk_unique(file_ids, CURSEFORGE_FILE_BATCH) {
        match curseforge::get_files_by_ids(chunk).await {
            Ok(found) => files.extend(found.into_iter().map(|file| (file.id, file))),
            Err(e) => {
                warn!("CurseForge file lookup failed for one batch: {}", e);
                complete = false;
            }
        }
    }

    for item in items.iter_mut() {
        if item.resolved.is_some() {
            continue;
        }
        let Some((mod_id, file_id)) = item.fingerprint.and_then(|fp| matches.get(&fp).copied()) else {
            continue;
        };
        let Some(file) = files.get(&file_id) else {
            continue;
        };

        info!(
            "Identified '{}' as CurseForge {}/{}",
            item.label(),
            mod_id,
            file_id
        );
        item.resolved = Some(mod_from_curseforge_file(file));
    }

    complete
}

async fn apply_display_names(items: &mut [JarIdentity]) {
    let mut modrinth_ids = Vec::new();
    let mut curseforge_ids = Vec::new();

    for item in items.iter() {
        match item.resolved.as_ref().map(|entry| &entry.source) {
            Some(ModSource::Modrinth { project_id, .. }) => modrinth_ids.push(project_id.clone()),
            Some(ModSource::CurseForge { project_id, .. }) => {
                if let Ok(id) = project_id.parse::<u32>() {
                    curseforge_ids.push(id);
                }
            }
            _ => {}
        }
    }

    let mut titles: HashMap<String, String> = HashMap::new();

    for chunk in chunk_unique(modrinth_ids, MODRINTH_HASH_BATCH) {
        match modrinth::get_multiple_projects(chunk).await {
            Ok(projects) => titles.extend(
                projects
                    .into_iter()
                    .map(|project| (project.id, project.title)),
            ),
            Err(e) => debug!("Could not fetch Modrinth project titles: {}", e),
        }
    }

    for chunk in chunk_unique(curseforge_ids, CURSEFORGE_FILE_BATCH) {
        match curseforge::get_mods_by_ids(chunk, Some(true)).await {
            Ok(response) => titles.extend(
                response
                    .data
                    .into_iter()
                    .map(|entry| (entry.id.to_string(), entry.name)),
            ),
            Err(e) => debug!("Could not fetch CurseForge project titles: {}", e),
        }
    }

    for item in items.iter_mut() {
        let Some(entry) = item.resolved.as_mut() else {
            continue;
        };
        let project_id = match &entry.source {
            ModSource::Modrinth { project_id, .. } | ModSource::CurseForge { project_id, .. } => {
                project_id.clone()
            }
            _ => continue,
        };
        if let Some(title) = titles.get(&project_id) {
            entry.display_name = Some(title.clone());
        }
    }
}

pub async fn identify_jars(paths: &[PathBuf]) -> Vec<JarIdentity> {
    if paths.is_empty() {
        return Vec::new();
    }

    identify(hash_jars(paths).await, paths).await
}

pub async fn identify_with_sha1(entries: Vec<(PathBuf, String)>) -> Vec<JarIdentity> {
    if entries.is_empty() {
        return Vec::new();
    }

    let paths: Vec<PathBuf> = entries.iter().map(|(path, _)| path.clone()).collect();
    let items = entries
        .into_iter()
        .map(|(path, sha1)| JarIdentity {
            path,
            sha1: Some(sha1.to_lowercase()),
            fingerprint: None,
            resolved: None,
        })
        .collect();

    identify(items, &paths).await
}

async fn identify(mut items: Vec<JarIdentity>, paths: &[PathBuf]) -> Vec<JarIdentity> {
    let cached = apply_cached(&mut items);

    let (known, mut pending): (Vec<JarIdentity>, Vec<JarIdentity>) = items
        .into_iter()
        .partition(|item| item.sha1.as_ref().is_some_and(|sha1| RESOLVED_BY_SHA1.contains_key(sha1)));

    if !pending.is_empty() {
        let modrinth_ok = resolve_with_modrinth(&mut pending).await;
        fingerprint_unresolved(&mut pending).await;
        let curseforge_ok = resolve_with_curseforge(&mut pending).await;
        apply_display_names(&mut pending).await;
        remember(&pending, modrinth_ok && curseforge_ok);
    }

    debug!(
        "identify_jars: {} from cache, {} looked up",
        cached,
        pending.len()
    );

    let mut by_path: HashMap<PathBuf, JarIdentity> = known
        .into_iter()
        .chain(pending)
        .map(|item| (item.path.clone(), item))
        .collect();

    paths
        .iter()
        .filter_map(|path| by_path.remove(path))
        .collect()
}

pub async fn identify_jar(path: &Path) -> Option<Mod> {
    identify_jars(std::slice::from_ref(&path.to_path_buf()))
        .await
        .pop()
        .and_then(|item| item.resolved)
}

pub fn mod_from_unified_version(version: &unified_mod::UnifiedVersion) -> Option<Mod> {
    let file = version
        .files
        .iter()
        .find(|entry| entry.primary)
        .or_else(|| version.files.first())?;

    let sha1 = file.hashes.get("sha1").cloned();
    let source = match version.source {
        unified_mod::ModPlatform::Modrinth => ModSource::Modrinth {
            project_id: version.project_id.clone(),
            version_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1,
        },
        unified_mod::ModPlatform::CurseForge => ModSource::CurseForge {
            project_id: version.project_id.clone(),
            file_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1,
            file_fingerprint: file.fingerprint,
        },
    };

    Some(Mod {
        id: Uuid::new_v4(),
        source,
        enabled: true,
        display_name: Some(version.name.clone()),
        version: Some(version.version_number.clone()),
        game_versions: Some(version.game_versions.clone()),
        file_name_override: None,
        associated_loader: version
            .loaders
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    })
}
