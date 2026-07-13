use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::post_init::PostInitializationHandler;
use crate::integrations::curseforge::{self, CurseForgeMod, CurseForgeModsResponse};
use crate::integrations::modrinth::{self, ModrinthProject, ModrinthTags, ModrinthVersion};
use crate::integrations::unified_mod::{
    self, ModPlatform, UnifiedModpackVersionsResponse, UnifiedUpdateCheckRequest,
    UnifiedUpdateCheckResponse, UnifiedVersion,
};
use crate::state::profile_state::ModPackSource;
use async_trait::async_trait;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};

const CONTENT_CACHE_FILENAME: &str = "content_cache.json";

const TTL_METADATA_MS: u64 = 30 * 60 * 1000;
const TTL_IMMUTABLE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const STALE_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS: u64 = 2000;

fn content_cache_path() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join(CONTENT_CACHE_FILENAME)
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CacheBehaviour {
    #[default]
    StaleWhileRevalidate,
    MustRevalidate,
    Bypass,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheEntry<T> {
    pub data: T,
    pub expires_at_ms: u64,
}

impl<T> CacheEntry<T> {
    fn new(data: T, ttl_ms: u64) -> Self {
        Self {
            data,
            expires_at_ms: now_ms() + ttl_ms,
        }
    }

    fn is_fresh(&self) -> bool {
        self.expires_at_ms > now_ms()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileHashEntry {
    pub size: u64,
    pub mtime_ms: u64,
    pub sha1: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ContentCacheData {
    #[serde(default)]
    pub file_hashes: HashMap<String, FileHashEntry>,
    #[serde(default)]
    pub modrinth_versions: HashMap<String, CacheEntry<Option<ModrinthVersion>>>,
    #[serde(default)]
    pub modrinth_projects: HashMap<String, CacheEntry<ModrinthProject>>,
    #[serde(default)]
    pub curseforge_mods: HashMap<u32, CacheEntry<CurseForgeMod>>,
    #[serde(default)]
    pub unified_updates: HashMap<String, CacheEntry<Option<UnifiedVersion>>>,
    #[serde(default)]
    pub modpack_versions: HashMap<String, CacheEntry<UnifiedModpackVersionsResponse>>,
    #[serde(default)]
    pub modrinth_tags: Option<CacheEntry<ModrinthTags>>,
}

impl ContentCacheData {
    fn prune(&mut self) {
        let cutoff = now_ms().saturating_sub(STALE_GRACE_MS);
        self.file_hashes
            .retain(|path, _| Path::new(path).exists());
        self.modrinth_versions.retain(|_, e| e.expires_at_ms > cutoff);
        self.modrinth_projects.retain(|_, e| e.expires_at_ms > cutoff);
        self.curseforge_mods.retain(|_, e| e.expires_at_ms > cutoff);
        self.unified_updates.retain(|_, e| e.expires_at_ms > cutoff);
        self.modpack_versions.retain(|_, e| e.expires_at_ms > cutoff);
        self.modrinth_tags = self
            .modrinth_tags
            .take()
            .filter(|e| e.expires_at_ms > cutoff);
    }
}

struct Inner {
    data: RwLock<ContentCacheData>,
    save_lock: Mutex<()>,
    save_scheduled: AtomicBool,
    modpack_fetch_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    tags_fetch_lock: Mutex<()>,
}

#[derive(Clone)]
pub struct ContentCacheManager {
    inner: Arc<Inner>,
}

impl ContentCacheManager {
    pub fn new() -> Result<Self> {
        Ok(Self {
            inner: Arc::new(Inner {
                data: RwLock::new(ContentCacheData::default()),
                save_lock: Mutex::new(()),
                save_scheduled: AtomicBool::new(false),
                modpack_fetch_locks: Mutex::new(HashMap::new()),
                tags_fetch_lock: Mutex::new(()),
            }),
        })
    }

    async fn load(&self) {
        let path = content_cache_path();
        if !path.exists() {
            info!("Content cache file not found, starting empty");
            return;
        }
        match fs::read_to_string(&path).await {
            Ok(raw) => match serde_json::from_str::<ContentCacheData>(&raw) {
                Ok(loaded) => {
                    info!(
                        "Loaded content cache: {} file hashes, {} modrinth versions, {} modrinth projects, {} curseforge mods, {} updates",
                        loaded.file_hashes.len(),
                        loaded.modrinth_versions.len(),
                        loaded.modrinth_projects.len(),
                        loaded.curseforge_mods.len(),
                        loaded.unified_updates.len()
                    );
                    *self.inner.data.write().await = loaded;
                }
                Err(e) => warn!("Failed to parse content cache, starting empty: {}", e),
            },
            Err(e) => warn!("Failed to read content cache, starting empty: {}", e),
        }
    }

    pub async fn save(&self) -> Result<()> {
        let _guard = self.inner.save_lock.lock().await;

        let data = self.inner.data.read().await.clone();
        let snapshot = tokio::task::spawn_blocking(move || {
            let mut data = data;
            data.prune();
            data
        })
        .await
        .map_err(|e| AppError::Other(format!("Content cache prune task failed: {}", e)))?;

        let path = content_cache_path();
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }
        fs::write(&path, serde_json::to_string(&snapshot)?).await?;
        debug!("Saved content cache to {:?}", path);
        Ok(())
    }

    fn schedule_save(&self) {
        if self
            .inner
            .save_scheduled
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let this = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(SAVE_DEBOUNCE_MS)).await;
            this.inner.save_scheduled.store(false, Ordering::SeqCst);
            if let Err(e) = this.save().await {
                warn!("Failed to save content cache: {}", e);
            }
        });
    }


    pub async fn get_file_hash(&self, path: &str, size: u64, mtime_ms: u64) -> Option<String> {
        let data = self.inner.data.read().await;
        data.file_hashes
            .get(path)
            .filter(|e| e.size == size && e.mtime_ms == mtime_ms)
            .map(|e| e.sha1.clone())
    }

    pub async fn put_file_hashes(&self, entries: Vec<(String, FileHashEntry)>) {
        if entries.is_empty() {
            return;
        }
        {
            let mut data = self.inner.data.write().await;
            for (path, entry) in entries {
                data.file_hashes.insert(path, entry);
            }
        }
        self.schedule_save();
    }


    pub async fn get_modrinth_versions_by_hashes(
        &self,
        hashes: Vec<String>,
        behaviour: CacheBehaviour,
    ) -> Result<HashMap<String, ModrinthVersion>> {
        if hashes.is_empty() {
            return Ok(HashMap::new());
        }
        if behaviour == CacheBehaviour::Bypass {
            let fetched = modrinth::get_versions_by_hashes(hashes.clone(), "sha1").await?;
            self.put_modrinth_versions(&hashes, &fetched).await;
            return Ok(fetched);
        }

        let serve_stale = behaviour == CacheBehaviour::StaleWhileRevalidate;
        let mut result = HashMap::new();
        let mut missing = Vec::new();
        let mut stale = Vec::new();

        {
            let data = self.inner.data.read().await;
            for hash in &hashes {
                match data.modrinth_versions.get(hash) {
                    Some(entry) if entry.is_fresh() => {
                        if let Some(version) = &entry.data {
                            result.insert(hash.clone(), version.clone());
                        }
                    }
                    Some(entry) => {
                        if serve_stale {
                            if let Some(version) = &entry.data {
                                result.insert(hash.clone(), version.clone());
                            }
                            stale.push(hash.clone());
                        } else {
                            missing.push(hash.clone());
                        }
                    }
                    None => missing.push(hash.clone()),
                }
            }
        }

        if !missing.is_empty() {
            match modrinth::get_versions_by_hashes(missing.clone(), "sha1").await {
                Ok(fetched) => {
                    self.put_modrinth_versions(&missing, &fetched).await;
                    result.extend(fetched);
                }
                Err(e) if serve_stale => {
                    warn!("Modrinth version lookup failed, serving cached subset: {}", e)
                }
                Err(e) => return Err(e),
            }
        }

        if !stale.is_empty() {
            let this = self.clone();
            tokio::spawn(async move {
                match modrinth::get_versions_by_hashes(stale.clone(), "sha1").await {
                    Ok(fetched) => this.put_modrinth_versions(&stale, &fetched).await,
                    Err(e) => warn!("Background refresh of Modrinth versions failed: {}", e),
                }
            });
        }

        Ok(result)
    }

    async fn put_modrinth_versions(
        &self,
        requested: &[String],
        fetched: &HashMap<String, ModrinthVersion>,
    ) {
        {
            let mut data = self.inner.data.write().await;
            for hash in requested {
                let entry = match fetched.get(hash) {
                    Some(version) => CacheEntry::new(Some(version.clone()), TTL_IMMUTABLE_MS),
                    None => CacheEntry::new(None, TTL_METADATA_MS),
                };
                data.modrinth_versions.insert(hash.clone(), entry);
            }
        }
        self.schedule_save();
    }

    pub async fn cache_modrinth_version(&self, version: &ModrinthVersion) {
        let sha1 = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .and_then(|f| f.hashes.sha1.clone());
        let Some(sha1) = sha1 else { return };
        {
            let mut data = self.inner.data.write().await;
            data.modrinth_versions.insert(
                sha1,
                CacheEntry::new(Some(version.clone()), TTL_IMMUTABLE_MS),
            );
        }
        self.schedule_save();
    }


    pub async fn get_modrinth_projects(
        &self,
        ids: Vec<String>,
        behaviour: CacheBehaviour,
    ) -> Result<Vec<ModrinthProject>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        if behaviour == CacheBehaviour::Bypass {
            let fetched = modrinth::get_multiple_projects(ids.clone()).await?;
            self.put_modrinth_projects(&ids, &fetched).await;
            return Ok(fetched);
        }

        let serve_stale = behaviour == CacheBehaviour::StaleWhileRevalidate;
        let mut result = Vec::new();
        let mut missing = Vec::new();
        let mut stale = Vec::new();

        {
            let data = self.inner.data.read().await;
            for id in &ids {
                match data.modrinth_projects.get(id) {
                    Some(entry) if entry.is_fresh() => result.push(entry.data.clone()),
                    Some(entry) => {
                        if serve_stale {
                            result.push(entry.data.clone());
                            stale.push(id.clone());
                        } else {
                            missing.push(id.clone());
                        }
                    }
                    None => missing.push(id.clone()),
                }
            }
        }

        if !missing.is_empty() {
            match modrinth::get_multiple_projects(missing.clone()).await {
                Ok(fetched) => {
                    self.put_modrinth_projects(&missing, &fetched).await;
                    result.extend(fetched);
                }
                Err(e) if serve_stale => {
                    warn!("Modrinth project lookup failed, serving cached subset: {}", e)
                }
                Err(e) => return Err(e),
            }
        }

        if !stale.is_empty() {
            let this = self.clone();
            tokio::spawn(async move {
                match modrinth::get_multiple_projects(stale.clone()).await {
                    Ok(fetched) => this.put_modrinth_projects(&stale, &fetched).await,
                    Err(e) => warn!("Background refresh of Modrinth projects failed: {}", e),
                }
            });
        }

        Ok(result)
    }

    async fn put_modrinth_projects(&self, requested: &[String], fetched: &[ModrinthProject]) {
        if fetched.is_empty() {
            return;
        }
        {
            let mut data = self.inner.data.write().await;
            for project in fetched {
                let aliases = requested.iter().filter(|id| {
                    id.eq_ignore_ascii_case(&project.id) || id.eq_ignore_ascii_case(&project.slug)
                });
                for alias in aliases {
                    data.modrinth_projects.insert(
                        alias.clone(),
                        CacheEntry::new(project.clone(), TTL_METADATA_MS),
                    );
                }
                data.modrinth_projects.insert(
                    project.id.clone(),
                    CacheEntry::new(project.clone(), TTL_METADATA_MS),
                );
            }
        }
        self.schedule_save();
    }


    pub async fn get_curseforge_mods(
        &self,
        mod_ids: Vec<u32>,
        filter_pc_only: Option<bool>,
        behaviour: CacheBehaviour,
    ) -> Result<CurseForgeModsResponse> {
        if mod_ids.is_empty() {
            return Ok(CurseForgeModsResponse { data: Vec::new() });
        }
        if behaviour == CacheBehaviour::Bypass || filter_pc_only.is_some() {
            let fetched = curseforge::get_mods_by_ids(mod_ids, filter_pc_only).await?;
            if filter_pc_only.is_none() {
                self.put_curseforge_mods(&fetched.data).await;
            }
            return Ok(fetched);
        }

        let serve_stale = behaviour == CacheBehaviour::StaleWhileRevalidate;
        let mut result = Vec::new();
        let mut missing = Vec::new();
        let mut stale = Vec::new();

        {
            let data = self.inner.data.read().await;
            for id in &mod_ids {
                match data.curseforge_mods.get(id) {
                    Some(entry) if entry.is_fresh() => result.push(entry.data.clone()),
                    Some(entry) => {
                        if serve_stale {
                            result.push(entry.data.clone());
                            stale.push(*id);
                        } else {
                            missing.push(*id);
                        }
                    }
                    None => missing.push(*id),
                }
            }
        }

        if !missing.is_empty() {
            match curseforge::get_mods_by_ids(missing.clone(), None).await {
                Ok(fetched) => {
                    self.put_curseforge_mods(&fetched.data).await;
                    result.extend(fetched.data);
                }
                Err(e) if serve_stale => {
                    warn!("CurseForge mod lookup failed, serving cached subset: {}", e)
                }
                Err(e) => return Err(e),
            }
        }

        if !stale.is_empty() {
            let this = self.clone();
            tokio::spawn(async move {
                match curseforge::get_mods_by_ids(stale, None).await {
                    Ok(fetched) => this.put_curseforge_mods(&fetched.data).await,
                    Err(e) => warn!("Background refresh of CurseForge mods failed: {}", e),
                }
            });
        }

        Ok(CurseForgeModsResponse { data: result })
    }

    pub async fn put_curseforge_mods(&self, fetched: &[CurseForgeMod]) {
        if fetched.is_empty() {
            return;
        }
        {
            let mut data = self.inner.data.write().await;
            for cf_mod in fetched {
                data.curseforge_mods
                    .insert(cf_mod.id, CacheEntry::new(cf_mod.clone(), TTL_METADATA_MS));
            }
        }
        self.schedule_save();
    }


    pub async fn check_mod_updates_unified(
        &self,
        request: UnifiedUpdateCheckRequest,
        behaviour: CacheBehaviour,
    ) -> Result<UnifiedUpdateCheckResponse> {
        if request.hashes.is_empty() {
            return Ok(UnifiedUpdateCheckResponse {
                updates: HashMap::new(),
                failed_platforms: Vec::new(),
            });
        }
        if behaviour == CacheBehaviour::Bypass {
            let fetched = unified_mod::check_mod_updates_unified(request.clone()).await?;
            self.put_unified_updates(&request, &request.hashes, &fetched)
                .await;
            return Ok(fetched);
        }

        let serve_stale = behaviour == CacheBehaviour::StaleWhileRevalidate;
        let mut updates = HashMap::new();
        let mut missing = Vec::new();
        let mut stale = Vec::new();

        {
            let data = self.inner.data.read().await;
            for identifier in &request.hashes {
                let key = update_cache_key(&request, identifier);
                match data.unified_updates.get(&key) {
                    Some(entry) if entry.is_fresh() => {
                        if let Some(version) = &entry.data {
                            updates.insert(identifier.clone(), version.clone());
                        }
                    }
                    Some(entry) => {
                        if serve_stale {
                            if let Some(version) = &entry.data {
                                updates.insert(identifier.clone(), version.clone());
                            }
                            stale.push(identifier.clone());
                        } else {
                            missing.push(identifier.clone());
                        }
                    }
                    None => missing.push(identifier.clone()),
                }
            }
        }

        let mut failed_platforms = Vec::new();
        if !missing.is_empty() {
            let sub_request = subset_request(&request, &missing);
            match unified_mod::check_mod_updates_unified(sub_request).await {
                Ok(fetched) => {
                    self.put_unified_updates(&request, &missing, &fetched)
                        .await;
                    updates.extend(fetched.updates);
                    failed_platforms = fetched.failed_platforms;
                }
                Err(e) if serve_stale => {
                    warn!("Unified update check failed, serving cached subset: {}", e)
                }
                Err(e) => return Err(e),
            }
        }

        if !stale.is_empty() {
            let this = self.clone();
            let sub_request = subset_request(&request, &stale);
            tokio::spawn(async move {
                match unified_mod::check_mod_updates_unified(sub_request.clone()).await {
                    Ok(fetched) => {
                        this.put_unified_updates(&sub_request, &stale, &fetched)
                            .await
                    }
                    Err(e) => warn!("Background refresh of unified updates failed: {}", e),
                }
            });
        }

        Ok(UnifiedUpdateCheckResponse {
            updates,
            failed_platforms,
        })
    }

    async fn put_unified_updates(
        &self,
        request: &UnifiedUpdateCheckRequest,
        requested: &[String],
        fetched: &UnifiedUpdateCheckResponse,
    ) {
        let cacheable: Vec<&String> = requested
            .iter()
            .filter(|identifier| {
                fetched.failed_platforms.is_empty()
                    || !fetched
                        .failed_platforms
                        .contains(&identifier_platform(request, identifier))
            })
            .collect();
        let skipped = requested.len() - cacheable.len();
        if skipped > 0 {
            warn!(
                "Skipping negative-cache write for {} identifiers on failed platforms {:?}",
                skipped, fetched.failed_platforms
            );
        }
        if cacheable.is_empty() {
            return;
        }
        {
            let mut data = self.inner.data.write().await;
            for identifier in cacheable {
                let entry =
                    CacheEntry::new(fetched.updates.get(identifier).cloned(), TTL_METADATA_MS);
                data.unified_updates
                    .insert(update_cache_key(request, identifier), entry);
            }
        }
        self.schedule_save();
    }


    pub async fn get_modpack_versions(
        &self,
        source: &ModPackSource,
        behaviour: CacheBehaviour,
    ) -> Result<UnifiedModpackVersionsResponse> {
        let key = modpack_cache_key(source);

        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self.read_modpack_versions(&key).await {
                if entry.is_fresh() {
                    return Ok(entry.data);
                }
                if behaviour == CacheBehaviour::StaleWhileRevalidate {
                    let this = self.clone();
                    let source = source.clone();
                    tokio::spawn(async move {
                        if let Err(e) = this.fetch_modpack_versions(&source).await {
                            warn!("Background refresh of modpack versions failed: {}", e);
                        }
                    });
                    return Ok(entry.data);
                }
            }
        }

        self.fetch_modpack_versions(source).await
    }

    async fn read_modpack_versions(
        &self,
        key: &str,
    ) -> Option<CacheEntry<UnifiedModpackVersionsResponse>> {
        self.inner.data.read().await.modpack_versions.get(key).cloned()
    }

    async fn fetch_modpack_versions(
        &self,
        source: &ModPackSource,
    ) -> Result<UnifiedModpackVersionsResponse> {
        let key = modpack_cache_key(source);

        let fetch_lock = {
            let mut locks = self.inner.modpack_fetch_locks.lock().await;
            locks.entry(key.clone()).or_default().clone()
        };
        let _guard = fetch_lock.lock().await;

        if let Some(entry) = self.read_modpack_versions(&key).await {
            if entry.is_fresh() {
                return Ok(entry.data);
            }
        }

        let fetched = unified_mod::get_modpack_versions_unified(source).await?;
        {
            let mut data = self.inner.data.write().await;
            data.modpack_versions
                .insert(key, CacheEntry::new(fetched.clone(), TTL_METADATA_MS));
        }
        self.schedule_save();
        Ok(fetched)
    }


    pub async fn get_modrinth_tags(&self, behaviour: CacheBehaviour) -> Result<ModrinthTags> {
        if behaviour != CacheBehaviour::Bypass {
            let cached = self.inner.data.read().await.modrinth_tags.clone();

            if let Some(entry) = cached {
                if entry.is_fresh() {
                    return Ok(entry.data);
                }
                if behaviour == CacheBehaviour::StaleWhileRevalidate {
                    let this = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = this.fetch_modrinth_tags().await {
                            warn!("Background refresh of Modrinth tags failed: {}", e);
                        }
                    });
                    return Ok(entry.data);
                }
            }
        }

        self.fetch_modrinth_tags().await
    }

    async fn fetch_modrinth_tags(&self) -> Result<ModrinthTags> {
        let _guard = self.inner.tags_fetch_lock.lock().await;

        let cached = self.inner.data.read().await.modrinth_tags.clone();
        if let Some(entry) = cached {
            if entry.is_fresh() {
                return Ok(entry.data);
            }
        }

        let fetched = modrinth::get_modrinth_tags().await?;
        {
            let mut data = self.inner.data.write().await;
            data.modrinth_tags = Some(CacheEntry::new(fetched.clone(), TTL_METADATA_MS));
        }
        self.schedule_save();
        Ok(fetched)
    }
}

fn modpack_cache_key(source: &ModPackSource) -> String {
    match source {
        ModPackSource::Modrinth {
            project_id,
            version_id,
        } => format!("modrinth:{}:{}", project_id, version_id),
        ModPackSource::CurseForge {
            project_id,
            file_id,
        } => format!("curseforge:{}:{}", project_id, file_id),
    }
}

#[async_trait]
impl PostInitializationHandler for ContentCacheManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        self.load().await;
        Ok(())
    }
}

fn identifier_platform(request: &UnifiedUpdateCheckRequest, identifier: &str) -> ModPlatform {
    request
        .hash_platforms
        .as_ref()
        .and_then(|map| map.get(identifier))
        .cloned()
        .unwrap_or(ModPlatform::Modrinth)
}

fn update_cache_key(request: &UnifiedUpdateCheckRequest, identifier: &str) -> String {
    let platform = identifier_platform(request, identifier);

    let mut game_versions = request.game_versions.clone();
    game_versions.sort();
    let mut loaders = request.loaders.clone();
    loaders.sort();

    format!(
        "{:?}:{}:{}:{}",
        platform,
        identifier,
        game_versions.join(","),
        loaders.join(",")
    )
}

fn subset_map<T: Clone>(
    map: &Option<HashMap<String, T>>,
    wanted: &std::collections::HashSet<&String>,
) -> Option<HashMap<String, T>> {
    map.as_ref().map(|m| {
        m.iter()
            .filter(|(k, _)| wanted.contains(k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    })
}

fn subset_request(
    request: &UnifiedUpdateCheckRequest,
    identifiers: &[String],
) -> UnifiedUpdateCheckRequest {
    let wanted: std::collections::HashSet<&String> = identifiers.iter().collect();

    UnifiedUpdateCheckRequest {
        hashes: identifiers.to_vec(),
        algorithm: request.algorithm.clone(),
        loaders: request.loaders.clone(),
        game_versions: request.game_versions.clone(),
        hash_platforms: subset_map(&request.hash_platforms, &wanted),
        hash_fingerprints: subset_map(&request.hash_fingerprints, &wanted),
        hash_installed_info: subset_map(&request.hash_installed_info, &wanted),
    }
}
