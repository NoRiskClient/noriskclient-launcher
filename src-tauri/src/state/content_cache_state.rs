use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::integrations::curseforge::{self, CurseForgeMod, CurseForgeModsResponse};
use crate::integrations::modrinth::{
    self, ModrinthProject, ModrinthTags, ModrinthTeamMember, ModrinthVersion,
};
use crate::integrations::unified_mod::{
    self, ModPlatform, UnifiedModpackVersionsResponse, UnifiedUpdateCheckRequest,
    UnifiedUpdateCheckResponse, UnifiedVersion,
};
use crate::state::post_init::PostInitializationHandler;
use crate::state::profile_state::ModPackSource;
use async_trait::async_trait;
use log::{debug, info, warn};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use crate::state::db::DbHandle;
use sqlx::Row;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;
use tokio::sync::{Mutex, OnceCell};

const TTL_METADATA_MS: u64 = 30 * 60 * 1000;
const TTL_IMMUTABLE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const STALE_GRACE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const NEVER_EXPIRES_MS: u64 = i64::MAX as u64;

const SINGLETON: &str = "__singleton__";

mod kind {
    pub const FILE_HASH: &str = "file_hash";
    pub const MODRINTH_VERSION: &str = "modrinth_version";
    pub const MODRINTH_PROJECT: &str = "modrinth_project";
    pub const CURSEFORGE_MOD: &str = "curseforge_mod";
    pub const UNIFIED_UPDATE: &str = "unified_update";
    pub const MODPACK_VERSIONS: &str = "modpack_versions";
    pub const MODRINTH_TAGS: &str = "modrinth_tags";
    pub const MODRINTH_MEMBERS: &str = "modrinth_project_members";
    pub const MODRINTH_PROJECT_VERSIONS: &str = "modrinth_project_versions";
    pub const CURSEFORGE_DESCRIPTION: &str = "curseforge_description";
    pub const PLAYER_OUTFIT: &str = "player_outfit";
    pub const PLAYER_ICON: &str = "player_icon";
}

fn player_key(uuid: &Uuid) -> String {
    uuid.simple().to_string()
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

struct Row2Write<T> {
    id: String,
    alias: Option<String>,
    data: Option<T>,
    ttl_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct CacheClearStats {
    pub rows_deleted: u64,
    pub bytes_before: u64,
    pub bytes_after: u64,
}

async fn db_size_bytes() -> u64 {
    let base = crate::state::db::db_path();
    let mut total = 0;
    for suffix in ["", "-wal", "-shm"] {
        let path = if suffix.is_empty() {
            base.clone()
        } else {
            base.with_extension(format!("db{}", suffix))
        };
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            total += meta.len();
        }
    }
    total
}

struct Inner {
    db: DbHandle,
    modpack_fetch_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    tags_fetch_lock: Mutex<()>,
    project_fetch_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Clone)]
pub struct ContentCacheManager {
    inner: Arc<Inner>,
}

impl ContentCacheManager {
    pub fn new(db: DbHandle) -> Result<Self> {
        Ok(Self {
            inner: Arc::new(Inner {
                db,
                modpack_fetch_locks: Mutex::new(HashMap::new()),
                tags_fetch_lock: Mutex::new(()),
                project_fetch_locks: Mutex::new(HashMap::new()),
            }),
        })
    }

    async fn pool(&self) -> Option<sqlx::SqlitePool> {
        crate::state::db::pool_of(&self.inner.db).await
    }

    async fn get_entries<T: DeserializeOwned + Clone>(
        &self,
        kind: &str,
        keys: &[String],
    ) -> HashMap<String, CacheEntry<Option<T>>> {
        let mut out = HashMap::new();
        if keys.is_empty() {
            return out;
        }
        let Some(pool) = self.pool().await else { return out };

        let keys_json = match serde_json::to_string(keys) {
            Ok(j) => j,
            Err(e) => {
                warn!("Could not encode cache keys: {}", e);
                return out;
            }
        };

        let rows = sqlx::query(
            r#"
            SELECT id, alias, data, expires FROM cache
             WHERE data_type = ?1
               AND ( id IN (SELECT value FROM json_each(?2))
                  OR (alias IS NOT NULL AND alias IN (SELECT value FROM json_each(?2))) )
            "#,
        )
        .bind(kind)
        .bind(&keys_json)
        .fetch_all(&pool)
        .await;

        let rows = match rows {
            Ok(r) => r,
            Err(e) => {
                warn!("Cache read for '{}' failed: {}", kind, e);
                return out;
            }
        };

        let mut poisoned: Vec<String> = Vec::new();

        for row in rows {
            let id: String = row.get("id");
            let alias: Option<String> = row.get("alias");
            let raw: Option<String> = row.get("data");
            let expires: i64 = row.get("expires");

            let data = match raw {
                None => None, // negative cache entry
                Some(json) => match serde_json::from_str::<T>(&json) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        debug!("Dropping undeserializable '{}' row {}: {}", kind, id, e);
                        poisoned.push(id.clone());
                        continue;
                    }
                },
            };

            let entry = CacheEntry {
                data,
                expires_at_ms: expires.max(0) as u64,
            };

            for key in keys {
                let matches_id = key.eq_ignore_ascii_case(&id);
                let matches_alias = alias
                    .as_ref()
                    .is_some_and(|a| key.eq_ignore_ascii_case(a));
                if matches_id || matches_alias {
                    out.insert(key.clone(), entry.clone());
                }
            }
        }

        if !poisoned.is_empty() {
            self.delete_ids(kind, &poisoned).await;
        }

        out
    }

    async fn get_entry<T: DeserializeOwned + Clone>(
        &self,
        kind: &str,
        key: &str,
    ) -> Option<CacheEntry<Option<T>>> {
        let mut found = self.get_entries::<T>(kind, &[key.to_string()]).await;
        found.remove(key)
    }

    pub async fn get_player_outfit<T: DeserializeOwned + Clone>(&self, uuid: &Uuid) -> Option<T> {
        self.get_entry::<T>(kind::PLAYER_OUTFIT, &player_key(uuid))
            .await
            .and_then(|entry| entry.data)
    }

    pub async fn put_player_outfit<T: Serialize>(&self, uuid: &Uuid, outfit: &T) {
        self.put_entry(
            kind::PLAYER_OUTFIT,
            &player_key(uuid),
            None,
            Some(outfit),
            TTL_IMMUTABLE_MS,
        )
        .await;
    }

    pub async fn get_player_icon<T: DeserializeOwned + Clone>(&self, uuid: &Uuid) -> Option<T> {
        self.get_entry::<T>(kind::PLAYER_ICON, &player_key(uuid))
            .await
            .and_then(|entry| entry.data)
    }

    pub async fn put_player_icon<T: Serialize>(&self, uuid: &Uuid, icon: &T) {
        self.put_entry(
            kind::PLAYER_ICON,
            &player_key(uuid),
            None,
            Some(icon),
            TTL_IMMUTABLE_MS,
        )
        .await;
    }

    pub async fn forget_player(&self, uuid: &Uuid) {
        let ids = vec![player_key(uuid)];
        self.delete_ids(kind::PLAYER_OUTFIT, &ids).await;
        self.delete_ids(kind::PLAYER_ICON, &ids).await;
    }

    async fn put_entries<T: Serialize>(&self, kind: &str, rows: Vec<Row2Write<T>>) {
        if rows.is_empty() {
            return;
        }
        let Some(pool) = self.pool().await else { return };

        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                warn!("Cache write for '{}' could not begin: {}", kind, e);
                return;
            }
        };

        let now = now_ms();
        for row in rows {
            let json = match row.data.as_ref().map(serde_json::to_string).transpose() {
                Ok(j) => j,
                Err(e) => {
                    warn!("Could not encode '{}' entry {}: {}", kind, row.id, e);
                    continue;
                }
            };
            let expires = now.saturating_add(row.ttl_ms).min(i64::MAX as u64) as i64;

            let res = sqlx::query(
                "INSERT OR REPLACE INTO cache (id, data_type, alias, data, expires)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(&row.id)
            .bind(kind)
            .bind(&row.alias)
            .bind(&json)
            .bind(expires)
            .execute(&mut *tx)
            .await;

            if let Err(e) = res {
                warn!("Cache write for '{}' entry {} failed: {}", kind, row.id, e);
            }
        }

        if let Err(e) = tx.commit().await {
            warn!("Cache write for '{}' could not commit: {}", kind, e);
        }
    }

    async fn put_entry<T: Serialize>(
        &self,
        kind: &str,
        id: &str,
        alias: Option<String>,
        data: Option<T>,
        ttl_ms: u64,
    ) {
        self.put_entries(
            kind,
            vec![Row2Write {
                id: id.to_string(),
                alias,
                data,
                ttl_ms,
            }],
        )
        .await;
    }

    async fn delete_ids(&self, kind: &str, ids: &[String]) {
        let Some(pool) = self.pool().await else { return };
        let Ok(ids_json) = serde_json::to_string(ids) else {
            return;
        };

        let res = sqlx::query(
            "DELETE FROM cache WHERE data_type = ?1 AND id IN (SELECT value FROM json_each(?2))",
        )
        .bind(kind)
        .bind(&ids_json)
        .execute(&pool)
        .await;

        if let Err(e) = res {
            warn!("Could not delete '{}' rows: {}", kind, e);
        }
    }

    async fn delete_expired(&self, grace_ms: u64) -> Result<u64> {
        let Some(pool) = self.pool().await else { return Ok(0) };
        let cutoff = now_ms().saturating_sub(grace_ms) as i64;

        let res = sqlx::query("DELETE FROM cache WHERE expires < ?1 AND data_type <> ?2")
            .bind(cutoff)
            .bind(kind::FILE_HASH)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Other(format!("Cache expiry sweep failed: {}", e)))?;

        Ok(res.rows_affected())
    }

    pub async fn clear(&self) -> Result<CacheClearStats> {
        let Some(pool) = self.pool().await else {
            return Ok(CacheClearStats::default());
        };

        let bytes_before = db_size_bytes().await;

        let deleted = sqlx::query("DELETE FROM cache")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Other(format!("Could not clear the cache: {}", e)))?
            .rows_affected();

        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&pool)
            .await;
        if let Err(e) = sqlx::query("VACUUM").execute(&pool).await {
            warn!("Cache VACUUM failed, the file will not shrink: {}", e);
        }

        let bytes_after = db_size_bytes().await;
        info!(
            "Cleared {} cache rows, {} KB freed",
            deleted,
            bytes_before.saturating_sub(bytes_after) / 1024
        );

        Ok(CacheClearStats {
            rows_deleted: deleted,
            bytes_before,
            bytes_after,
        })
    }

    async fn prune_missing_files(&self) -> Result<u64> {
        let Some(pool) = self.pool().await else { return Ok(0) };

        let rows = sqlx::query("SELECT id FROM cache WHERE data_type = ?1")
            .bind(kind::FILE_HASH)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Other(format!("Could not list file hashes: {}", e)))?;

        let paths: Vec<String> = rows.iter().map(|r| r.get::<String, _>("id")).collect();
        if paths.is_empty() {
            return Ok(0);
        }

        let gone = tokio::task::spawn_blocking(move || {
            paths
                .into_iter()
                .filter(|p| !Path::new(p).exists())
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|e| AppError::Other(format!("File-hash prune task failed: {}", e)))?;

        if gone.is_empty() {
            return Ok(0);
        }
        let n = gone.len() as u64;
        self.delete_ids(kind::FILE_HASH, &gone).await;
        Ok(n)
    }

    pub async fn save(&self) -> Result<()> {
        if let Some(pool) = self.pool().await {
            let _ = sqlx::query("PRAGMA wal_checkpoint(PASSIVE)")
                .execute(&pool)
                .await;
        }
        Ok(())
    }

    pub async fn get_file_hash(&self, path: &str, size: u64, mtime_ms: u64) -> Option<String> {
        self.get_file_hashes(&[(path.to_string(), size, mtime_ms)])
            .await
            .remove(path)
    }

    pub async fn get_file_hashes(
        &self,
        requests: &[(String, u64, u64)],
    ) -> HashMap<String, String> {
        let mut out = HashMap::new();
        if requests.is_empty() {
            return out;
        }

        let paths: Vec<String> = requests.iter().map(|(p, _, _)| p.clone()).collect();
        let cached = self
            .get_entries::<FileHashEntry>(kind::FILE_HASH, &paths)
            .await;

        for (path, size, mtime_ms) in requests {
            if let Some(entry) = cached.get(path) {
                if let Some(hash) = &entry.data {
                    if hash.size == *size && hash.mtime_ms == *mtime_ms {
                        out.insert(path.clone(), hash.sha1.clone());
                    }
                }
            }
        }

        out
    }

    pub async fn put_file_hashes(&self, entries: Vec<(String, FileHashEntry)>) {
        let rows = entries
            .into_iter()
            .map(|(path, entry)| Row2Write {
                id: path,
                alias: None,
                data: Some(entry),
                ttl_ms: NEVER_EXPIRES_MS,
            })
            .collect();
        self.put_entries(kind::FILE_HASH, rows).await;
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

        let cached = self
            .get_entries::<ModrinthVersion>(kind::MODRINTH_VERSION, &hashes)
            .await;

        for hash in &hashes {
            match cached.get(hash) {
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
        let rows = requested
            .iter()
            .map(|hash| match fetched.get(hash) {
                Some(version) => Row2Write {
                    id: hash.clone(),
                    alias: None,
                    data: Some(version.clone()),
                    ttl_ms: TTL_IMMUTABLE_MS,
                },
                None => Row2Write {
                    id: hash.clone(),
                    alias: None,
                    data: None,
                    ttl_ms: TTL_METADATA_MS,
                },
            })
            .collect();
        self.put_entries(kind::MODRINTH_VERSION, rows).await;
    }

    pub async fn cache_modrinth_version(&self, version: &ModrinthVersion) {
        let sha1 = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first())
            .and_then(|f| f.hashes.sha1.clone());
        let Some(sha1) = sha1 else { return };

        self.put_entry(
            kind::MODRINTH_VERSION,
            &sha1,
            None,
            Some(version.clone()),
            TTL_IMMUTABLE_MS,
        )
        .await;
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
            self.put_modrinth_projects(&fetched).await;
            return Ok(fetched);
        }

        let serve_stale = behaviour == CacheBehaviour::StaleWhileRevalidate;
        let mut result = Vec::new();
        let mut missing = Vec::new();
        let mut stale = Vec::new();

        let cached = self
            .get_entries::<ModrinthProject>(kind::MODRINTH_PROJECT, &ids)
            .await;

        for id in &ids {
            match cached.get(id).and_then(|e| {
                e.data
                    .as_ref()
                    .map(|d| (d.clone(), e.expires_at_ms, e.is_fresh()))
            }) {
                Some((project, _, true)) => result.push(project),
                Some((project, _, false)) => {
                    if serve_stale {
                        result.push(project);
                        stale.push(id.clone());
                    } else {
                        missing.push(id.clone());
                    }
                }
                None => missing.push(id.clone()),
            }
        }

        if !missing.is_empty() {
            match modrinth::get_multiple_projects(missing.clone()).await {
                Ok(fetched) => {
                    self.put_modrinth_projects(&fetched).await;
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
                match modrinth::get_multiple_projects(stale).await {
                    Ok(fetched) => this.put_modrinth_projects(&fetched).await,
                    Err(e) => warn!("Background refresh of Modrinth projects failed: {}", e),
                }
            });
        }

        Ok(result)
    }

    pub async fn peek_modrinth_projects(
        &self,
        ids: Vec<String>,
    ) -> HashMap<String, ModrinthProject> {
        self.get_entries::<ModrinthProject>(kind::MODRINTH_PROJECT, &ids)
            .await
            .into_iter()
            .filter_map(|(key, entry)| entry.data.map(|project| (key, project)))
            .collect()
    }

    async fn put_modrinth_projects(&self, fetched: &[ModrinthProject]) {
        let rows = fetched
            .iter()
            .map(|project| Row2Write {
                id: project.id.clone(),
                alias: Some(project.slug.clone()),
                data: Some(project.clone()),
                ttl_ms: TTL_METADATA_MS,
            })
            .collect();
        self.put_entries(kind::MODRINTH_PROJECT, rows).await;
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

        let keys: Vec<String> = mod_ids.iter().map(|id| id.to_string()).collect();
        let cached = self
            .get_entries::<CurseForgeMod>(kind::CURSEFORGE_MOD, &keys)
            .await;

        for id in &mod_ids {
            let key = id.to_string();
            match cached.get(&key).and_then(|e| {
                e.data.as_ref().map(|d| (d.clone(), e.is_fresh()))
            }) {
                Some((cf_mod, true)) => result.push(cf_mod),
                Some((cf_mod, false)) => {
                    if serve_stale {
                        result.push(cf_mod);
                        stale.push(*id);
                    } else {
                        missing.push(*id);
                    }
                }
                None => missing.push(*id),
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

    pub async fn peek_curseforge_mods(&self, mod_ids: Vec<u32>) -> HashMap<u32, CurseForgeMod> {
        let keys: Vec<String> = mod_ids.iter().map(|id| id.to_string()).collect();
        self.get_entries::<CurseForgeMod>(kind::CURSEFORGE_MOD, &keys)
            .await
            .into_iter()
            .filter_map(|(key, entry)| {
                let id = key.parse::<u32>().ok()?;
                entry.data.map(|cf_mod| (id, cf_mod))
            })
            .collect()
    }

    pub async fn put_curseforge_mods(&self, fetched: &[CurseForgeMod]) {
        let rows = fetched
            .iter()
            .map(|cf_mod| Row2Write {
                id: cf_mod.id.to_string(),
                alias: None,
                data: Some(cf_mod.clone()),
                ttl_ms: TTL_METADATA_MS,
            })
            .collect();
        self.put_entries(kind::CURSEFORGE_MOD, rows).await;
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

        let keys: Vec<String> = request
            .hashes
            .iter()
            .map(|identifier| update_cache_key(&request, identifier))
            .collect();
        let cached = self
            .get_entries::<UnifiedVersion>(kind::UNIFIED_UPDATE, &keys)
            .await;

        for identifier in &request.hashes {
            let key = update_cache_key(&request, identifier);
            match cached.get(&key) {
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

        let mut failed_platforms = Vec::new();
        if !missing.is_empty() {
            let sub_request = subset_request(&request, &missing);
            match unified_mod::check_mod_updates_unified(sub_request).await {
                Ok(fetched) => {
                    self.put_unified_updates(&request, &missing, &fetched).await;
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

        let rows = cacheable
            .into_iter()
            .map(|identifier| Row2Write {
                id: update_cache_key(request, identifier),
                alias: None,
                data: fetched.updates.get(identifier).cloned(),
                ttl_ms: TTL_METADATA_MS,
            })
            .collect();
        self.put_entries(kind::UNIFIED_UPDATE, rows).await;
    }

    pub async fn get_modpack_versions(
        &self,
        source: &ModPackSource,
        behaviour: CacheBehaviour,
    ) -> Result<UnifiedModpackVersionsResponse> {
        let key = modpack_cache_key(source);

        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self
                .get_entry::<UnifiedModpackVersionsResponse>(kind::MODPACK_VERSIONS, &key)
                .await
            {
                if let Some(data) = entry.data {
                    if entry.expires_at_ms > now_ms() {
                        return Ok(data);
                    }
                    if behaviour == CacheBehaviour::StaleWhileRevalidate {
                        let this = self.clone();
                        let source = source.clone();
                        tokio::spawn(async move {
                            if let Err(e) = this.fetch_modpack_versions(&source).await {
                                warn!("Background refresh of modpack versions failed: {}", e);
                            }
                        });
                        return Ok(data);
                    }
                }
            }
        }

        self.fetch_modpack_versions(source).await
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

        if let Some(entry) = self
            .get_entry::<UnifiedModpackVersionsResponse>(kind::MODPACK_VERSIONS, &key)
            .await
        {
            if entry.is_fresh() {
                if let Some(data) = entry.data {
                    return Ok(data);
                }
            }
        }

        let fetched = unified_mod::get_modpack_versions_unified(source).await?;
        self.put_entry(
            kind::MODPACK_VERSIONS,
            &key,
            None,
            Some(fetched.clone()),
            TTL_METADATA_MS,
        )
        .await;
        Ok(fetched)
    }

    pub async fn get_modrinth_tags(&self, behaviour: CacheBehaviour) -> Result<ModrinthTags> {
        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self
                .get_entry::<ModrinthTags>(kind::MODRINTH_TAGS, SINGLETON)
                .await
            {
                if let Some(data) = entry.data {
                    if entry.expires_at_ms > now_ms() {
                        return Ok(data);
                    }
                    if behaviour == CacheBehaviour::StaleWhileRevalidate {
                        let this = self.clone();
                        tokio::spawn(async move {
                            if let Err(e) = this.fetch_modrinth_tags().await {
                                warn!("Background refresh of Modrinth tags failed: {}", e);
                            }
                        });
                        return Ok(data);
                    }
                }
            }
        }

        self.fetch_modrinth_tags().await
    }

    async fn fetch_modrinth_tags(&self) -> Result<ModrinthTags> {
        let _guard = self.inner.tags_fetch_lock.lock().await;

        if let Some(entry) = self
            .get_entry::<ModrinthTags>(kind::MODRINTH_TAGS, SINGLETON)
            .await
        {
            if entry.is_fresh() {
                if let Some(data) = entry.data {
                    return Ok(data);
                }
            }
        }

        let fetched = modrinth::get_modrinth_tags().await?;
        self.put_entry(
            kind::MODRINTH_TAGS,
            SINGLETON,
            None,
            Some(fetched.clone()),
            TTL_METADATA_MS,
        )
        .await;
        Ok(fetched)
    }

    pub async fn get_modrinth_project_members(
        &self,
        project_id_or_slug: &str,
        behaviour: CacheBehaviour,
    ) -> Result<Vec<ModrinthTeamMember>> {
        let key = project_id_or_slug.to_string();

        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self
                .get_entry::<Vec<ModrinthTeamMember>>(kind::MODRINTH_MEMBERS, &key)
                .await
            {
                if let Some(data) = entry.data {
                    if entry.expires_at_ms > now_ms() {
                        return Ok(data);
                    }
                    if behaviour == CacheBehaviour::StaleWhileRevalidate {
                        let this = self.clone();
                        let key = key.clone();
                        tokio::spawn(async move {
                            if let Err(e) = this.fetch_project_members(&key).await {
                                warn!("Background refresh of project members failed: {}", e);
                            }
                        });
                        return Ok(data);
                    }
                }
            }
        }

        self.fetch_project_members(&key).await
    }

    async fn fetch_project_members(&self, key: &str) -> Result<Vec<ModrinthTeamMember>> {
        let _guard = self.project_fetch_lock(&format!("members:{}", key)).await;

        if let Some(entry) = self
            .get_entry::<Vec<ModrinthTeamMember>>(kind::MODRINTH_MEMBERS, key)
            .await
        {
            if entry.is_fresh() {
                if let Some(data) = entry.data {
                    return Ok(data);
                }
            }
        }

        let fetched = modrinth::get_project_members(key.to_string()).await?;
        self.put_entry(
            kind::MODRINTH_MEMBERS,
            key,
            None,
            Some(fetched.clone()),
            TTL_METADATA_MS,
        )
        .await;
        Ok(fetched)
    }

    pub async fn get_modrinth_project_versions(
        &self,
        project_id_or_slug: &str,
        loaders: Option<Vec<String>>,
        game_versions: Option<Vec<String>>,
        behaviour: CacheBehaviour,
    ) -> Result<Vec<ModrinthVersion>> {
        let key = project_versions_cache_key(project_id_or_slug, &loaders, &game_versions);

        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self
                .get_entry::<Vec<ModrinthVersion>>(kind::MODRINTH_PROJECT_VERSIONS, &key)
                .await
            {
                if let Some(data) = entry.data {
                    if entry.expires_at_ms > now_ms() {
                        return Ok(data);
                    }
                    if behaviour == CacheBehaviour::StaleWhileRevalidate {
                        let this = self.clone();
                        let (id, key) = (project_id_or_slug.to_string(), key.clone());
                        let (loaders, game_versions) = (loaders.clone(), game_versions.clone());
                        tokio::spawn(async move {
                            if let Err(e) = this
                                .fetch_project_versions(&id, &key, loaders, game_versions)
                                .await
                            {
                                warn!("Background refresh of project versions failed: {}", e);
                            }
                        });
                        return Ok(data);
                    }
                }
            }
        }

        self.fetch_project_versions(project_id_or_slug, &key, loaders, game_versions)
            .await
    }

    async fn fetch_project_versions(
        &self,
        project_id_or_slug: &str,
        key: &str,
        loaders: Option<Vec<String>>,
        game_versions: Option<Vec<String>>,
    ) -> Result<Vec<ModrinthVersion>> {
        let _guard = self.project_fetch_lock(&format!("versions:{}", key)).await;

        if let Some(entry) = self
            .get_entry::<Vec<ModrinthVersion>>(kind::MODRINTH_PROJECT_VERSIONS, key)
            .await
        {
            if entry.is_fresh() {
                if let Some(data) = entry.data {
                    return Ok(data);
                }
            }
        }

        let fetched =
            modrinth::get_mod_versions(project_id_or_slug.to_string(), loaders, game_versions)
                .await?;
        self.put_entry(
            kind::MODRINTH_PROJECT_VERSIONS,
            key,
            None,
            Some(fetched.clone()),
            TTL_METADATA_MS,
        )
        .await;
        Ok(fetched)
    }

    pub async fn get_curseforge_description(
        &self,
        mod_id: u32,
        behaviour: CacheBehaviour,
    ) -> Result<String> {
        let key = mod_id.to_string();

        if behaviour != CacheBehaviour::Bypass {
            if let Some(entry) = self
                .get_entry::<String>(kind::CURSEFORGE_DESCRIPTION, &key)
                .await
            {
                if let Some(data) = entry.data {
                    if entry.expires_at_ms > now_ms() {
                        return Ok(data);
                    }
                    if behaviour == CacheBehaviour::StaleWhileRevalidate {
                        let this = self.clone();
                        tokio::spawn(async move {
                            if let Err(e) = this.fetch_curseforge_description(mod_id).await {
                                warn!("Background refresh of CurseForge description failed: {}", e);
                            }
                        });
                        return Ok(data);
                    }
                }
            }
        }

        self.fetch_curseforge_description(mod_id).await
    }

    async fn fetch_curseforge_description(&self, mod_id: u32) -> Result<String> {
        let key = mod_id.to_string();
        let _guard = self
            .project_fetch_lock(&format!("cf-description:{}", key))
            .await;

        if let Some(entry) = self
            .get_entry::<String>(kind::CURSEFORGE_DESCRIPTION, &key)
            .await
        {
            if entry.is_fresh() {
                if let Some(data) = entry.data {
                    return Ok(data);
                }
            }
        }

        let fetched = curseforge::get_mod_description(mod_id).await?;
        self.put_entry(
            kind::CURSEFORGE_DESCRIPTION,
            &key,
            None,
            Some(fetched.clone()),
            TTL_METADATA_MS,
        )
        .await;
        Ok(fetched)
    }

    async fn project_fetch_lock(&self, key: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.inner.project_fetch_locks.lock().await;
            locks.entry(key.to_string()).or_default().clone()
        };
        lock.lock_owned().await
    }
}

fn project_versions_cache_key(
    project_id_or_slug: &str,
    loaders: &Option<Vec<String>>,
    game_versions: &Option<Vec<String>>,
) -> String {
    let sorted = |v: &Option<Vec<String>>| {
        v.as_ref()
            .map(|list| {
                let mut list = list.clone();
                list.sort();
                list.join(",")
            })
            .unwrap_or_default()
    };

    format!(
        "{}:{}:{}",
        project_id_or_slug,
        sorted(loaders),
        sorted(game_versions)
    )
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

#[cfg(test)]
#[path = "content_cache_state_test.rs"]
mod tests;

#[async_trait]
impl PostInitializationHandler for ContentCacheManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        let legacy = LAUNCHER_DIRECTORY.meta_dir().join("content_cache.json");
        if legacy.exists() {
            match tokio::fs::remove_file(&legacy).await {
                Ok(()) => info!("Removed legacy content_cache.json (superseded by app.db)"),
                Err(e) => warn!("Could not remove legacy content_cache.json: {}", e),
            }
        }

        let this = self.clone();
        tokio::spawn(async move {
            let mut removed = 0;

            match this.delete_expired(STALE_GRACE_MS).await {
                Ok(n) => {
                    if n > 0 {
                        info!("Cache sweep removed {} expired rows", n);
                    }
                    removed += n;
                }
                Err(e) => warn!("Cache expiry sweep failed: {}", e),
            }
            match this.prune_missing_files().await {
                Ok(n) => {
                    if n > 0 {
                        info!("Cache sweep removed {} stale file hashes", n);
                    }
                    removed += n;
                }
                Err(e) => warn!("File-hash prune failed: {}", e),
            }

            if removed > 0 {
                if let Some(pool) = this.pool().await {
                    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                        .execute(&pool)
                        .await;
                    if let Err(e) = sqlx::query("VACUUM").execute(&pool).await {
                        warn!("Cache VACUUM after sweep failed: {}", e);
                    }
                }
            }
        });

        Ok(())
    }
}
