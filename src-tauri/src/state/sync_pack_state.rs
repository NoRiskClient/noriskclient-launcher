use crate::error::{AppError, Result};
use crate::state::db::DbHandle;
use crate::state::post_init::PostInitializationHandler;
use crate::state::profile_state::Mod;
use crate::sync::model::{
    SyncPack, SyncPackModEntry, SyncTarget, SyncTargetKind, SyncTargetState,
    VersionOverride,
};
use crate::sync::resolution::ResolvedVersion;
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use dashmap::DashMap;
use log::{debug, info, warn};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

pub const PACK_LOCK_TIMEOUT: Duration = Duration::from_secs(5);

fn no_db() -> AppError {
    AppError::Other("The launcher database is not available, sync packs are disabled".to_string())
}

fn to_datetime(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms).single().unwrap_or_else(Utc::now)
}

struct Inner {
    db: DbHandle,
    locks: DashMap<Uuid, Arc<Mutex<()>>>,
}

#[derive(Clone)]
pub struct SyncPackManager {
    inner: Arc<Inner>,
}

impl SyncPackManager {
    pub fn new(db: DbHandle) -> Result<Self> {
        Ok(Self {
            inner: Arc::new(Inner {
                db,
                locks: DashMap::new(),
            }),
        })
    }

    pub fn lock_for(&self, pack_id: Uuid) -> Arc<Mutex<()>> {
        self.inner
            .locks
            .entry(pack_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn pool(&self) -> Result<SqlitePool> {
        crate::state::db::pool_of(&self.inner.db).await.ok_or_else(no_db)
    }

    pub async fn is_available(&self) -> bool {
        crate::state::db::pool_of(&self.inner.db).await.is_some()
    }

    fn row_to_pack(row: &sqlx::sqlite::SqliteRow) -> Result<SyncPack> {
        let id: String = row.get("id");
        let id = Uuid::parse_str(&id)
            .map_err(|e| AppError::Other(format!("Invalid sync pack id '{}': {}", id, e)))?;
        let created: i64 = row.get("created");
        let updated: i64 = row.get("updated");
        let enabled: i64 = row.get("enabled");

        Ok(SyncPack {
            id,
            name: row.get("name"),
            description: row.get("description"),
            icon: row.get("icon"),
            created: to_datetime(created),
            updated: to_datetime(updated),
            enabled: enabled != 0,
            sort_order: row.get("sort_order"),
            targets: Vec::new(),
            mods: Vec::new(),
        })
    }

    fn row_to_target(row: &sqlx::sqlite::SqliteRow) -> Result<SyncTarget> {
        let id: String = row.get("id");
        let id = Uuid::parse_str(&id)
            .map_err(|e| AppError::Other(format!("Invalid sync target id '{}': {}", id, e)))?;
        let kind_json: String = row.get("kind");
        let kind: SyncTargetKind = serde_json::from_str(&kind_json).map_err(|e| {
            AppError::Other(format!("Could not decode sync target kind '{}': {}", kind_json, e))
        })?;
        let enabled: i64 = row.get("enabled");

        Ok(SyncTarget {
            id,
            path: row.get("path"),
            enabled: enabled != 0,
            kind,
            external_path: row.get("external_path"),
        })
    }

    async fn load_targets(pool: &SqlitePool, pack_ids: &[Uuid]) -> Result<HashMap<Uuid, Vec<SyncTarget>>> {
        let mut out: HashMap<Uuid, Vec<SyncTarget>> = HashMap::new();
        if pack_ids.is_empty() {
            return Ok(out);
        }

        let keys: Vec<String> = pack_ids.iter().map(|id| id.to_string()).collect();
        let keys_json = serde_json::to_string(&keys)?;

        let rows = sqlx::query(
            r#"
            SELECT id, pack_id, path, enabled, kind, external_path FROM sync_pack_targets
             WHERE pack_id IN (SELECT value FROM json_each(?1))
             ORDER BY path ASC
            "#,
        )
        .bind(&keys_json)
        .fetch_all(pool)
        .await?;

        for row in rows {
            let pack_id: String = row.get("pack_id");
            let Ok(pack_id) = Uuid::parse_str(&pack_id) else { continue };
            match Self::row_to_target(&row) {
                Ok(target) => out.entry(pack_id).or_default().push(target),
                Err(e) => warn!("Dropping unreadable sync target row: {}", e),
            }
        }

        Ok(out)
    }

    async fn load_mods(
        pool: &SqlitePool,
        pack_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<SyncPackModEntry>>> {
        let mut out: HashMap<Uuid, Vec<SyncPackModEntry>> = HashMap::new();
        if pack_ids.is_empty() {
            return Ok(out);
        }

        let keys: Vec<String> = pack_ids.iter().map(|id| id.to_string()).collect();
        let keys_json = serde_json::to_string(&keys)?;

        let rows = sqlx::query(
            r#"
            SELECT pack_id, mod_id, data, version_overrides FROM sync_pack_mods
             WHERE pack_id IN (SELECT value FROM json_each(?1))
            "#,
        )
        .bind(&keys_json)
        .fetch_all(pool)
        .await?;

        for row in rows {
            let pack_id: String = row.get("pack_id");
            let Ok(pack_id) = Uuid::parse_str(&pack_id) else { continue };
            let data: String = row.get("data");
            match serde_json::from_str::<Mod>(&data) {
                Ok(info) => {
                    let overrides_json: String = row.get("version_overrides");
                    let version_overrides =
                        serde_json::from_str::<HashMap<String, VersionOverride>>(&overrides_json)
                            .unwrap_or_default();
                    out.entry(pack_id).or_default().push(SyncPackModEntry {
                        info,
                        version_overrides,
                    });
                }
                Err(e) => {
                    let mod_id: String = row.get("mod_id");
                    warn!("Dropping unreadable sync pack mod {}: {}", mod_id, e);
                }
            }
        }

        Ok(out)
    }

    pub async fn list_packs(&self) -> Result<Vec<SyncPack>> {
        let pool = self.pool().await?;
        let rows = sqlx::query("SELECT * FROM sync_packs ORDER BY sort_order ASC, created ASC")
            .fetch_all(&pool)
            .await?;

        let mut packs: Vec<SyncPack> = Vec::with_capacity(rows.len());
        for row in &rows {
            match Self::row_to_pack(row) {
                Ok(p) => packs.push(p),
                Err(e) => warn!("Dropping unreadable sync pack row: {}", e),
            }
        }

        let ids: Vec<Uuid> = packs.iter().map(|p| p.id).collect();
        let mut targets = Self::load_targets(&pool, &ids).await?;
        let mut mods = Self::load_mods(&pool, &ids).await?;

        for pack in packs.iter_mut() {
            pack.targets = targets.remove(&pack.id).unwrap_or_default();
            pack.mods = mods.remove(&pack.id).unwrap_or_default();
        }

        Ok(packs)
    }

    pub async fn get_pack(&self, pack_id: Uuid) -> Result<Option<SyncPack>> {
        let pool = self.pool().await?;
        let row = sqlx::query("SELECT * FROM sync_packs WHERE id = ?1")
            .bind(pack_id.to_string())
            .fetch_optional(&pool)
            .await?;

        let Some(row) = row else { return Ok(None) };
        let mut pack = Self::row_to_pack(&row)?;
        let ids = [pack.id];
        pack.targets = Self::load_targets(&pool, &ids).await?.remove(&pack.id).unwrap_or_default();
        pack.mods = Self::load_mods(&pool, &ids).await?.remove(&pack.id).unwrap_or_default();
        Ok(Some(pack))
    }

    pub async fn require_pack(&self, pack_id: Uuid) -> Result<SyncPack> {
        self.get_pack(pack_id).await?.ok_or_else(|| {
            AppError::Other(format!("Sync pack {} does not exist", pack_id))
        })
    }

    pub async fn get_packs(&self, pack_ids: &[Uuid]) -> Result<Vec<SyncPack>> {
        if pack_ids.is_empty() {
            return Ok(Vec::new());
        }
        let all = self.list_packs().await?;
        let by_id: HashMap<Uuid, SyncPack> = all.into_iter().map(|p| (p.id, p)).collect();
        Ok(pack_ids.iter().filter_map(|id| by_id.get(id).cloned()).collect())
    }

    pub async fn create_pack(
        &self,
        name: String,
        description: Option<String>,
        icon: Option<String>,
    ) -> Result<SyncPack> {
        let pool = self.pool().await?;
        let now = Utc::now();
        let now_ms = now.timestamp_millis();
        let id = Uuid::new_v4();

        let next_order: i64 = sqlx::query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM sync_packs")
            .fetch_one(&pool)
            .await
            .map(|row| row.get::<i64, _>("next"))
            .unwrap_or(0);

        sqlx::query(
            r#"
            INSERT INTO sync_packs (id, name, description, icon, enabled, sort_order, created, updated)
            VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)
            "#,
        )
        .bind(id.to_string())
        .bind(&name)
        .bind(&description)
        .bind(&icon)
        .bind(next_order)
        .bind(now_ms)
        .execute(&pool)
        .await?;

        crate::sync::paths::ensure_pack_dirs(id).await?;
        info!("Created sync pack '{}' ({})", name, id);

        Ok(SyncPack {
            id,
            name,
            description,
            icon,
            created: now,
            updated: now,
            enabled: true,
            sort_order: next_order,
            targets: Vec::new(),
            mods: Vec::new(),
        })
    }

    pub async fn update_pack_meta(
        &self,
        pack_id: Uuid,
        name: Option<String>,
        description: Option<Option<String>>,
        icon: Option<Option<String>>,
        enabled: Option<bool>,
        sort_order: Option<i64>,
    ) -> Result<SyncPack> {
        let pool = self.pool().await?;
        let Some(current) = self.get_pack(pack_id).await? else {
            return Err(AppError::Other(format!("Sync pack {} does not exist", pack_id)));
        };

        let name = name.unwrap_or(current.name);
        let description = description.unwrap_or(current.description);
        let icon = icon.unwrap_or(current.icon);
        let enabled = enabled.unwrap_or(current.enabled);
        let sort_order = sort_order.unwrap_or(current.sort_order);
        let now_ms = Utc::now().timestamp_millis();

        sqlx::query(
            r#"
            UPDATE sync_packs
               SET name = ?2, description = ?3, icon = ?4, enabled = ?5, sort_order = ?6, updated = ?7
             WHERE id = ?1
            "#,
        )
        .bind(pack_id.to_string())
        .bind(&name)
        .bind(&description)
        .bind(&icon)
        .bind(if enabled { 1_i64 } else { 0_i64 })
        .bind(sort_order)
        .bind(now_ms)
        .execute(&pool)
        .await?;

        self.get_pack(pack_id)
            .await?
            .ok_or_else(|| AppError::Other(format!("Sync pack {} vanished during update", pack_id)))
    }

    async fn touch(&self, pool: &SqlitePool, pack_id: Uuid) {
        let _ = sqlx::query("UPDATE sync_packs SET updated = ?2 WHERE id = ?1")
            .bind(pack_id.to_string())
            .bind(Utc::now().timestamp_millis())
            .execute(pool)
            .await;
    }

    pub async fn delete_pack(&self, pack_id: Uuid) -> Result<()> {
        let pool = self.pool().await?;
        let mut tx = pool
            .begin()
            .await?;

        let key = pack_id.to_string();
        for stmt in [
            "DELETE FROM sync_pack_adoptions WHERE pack_id = ?1",
            "DELETE FROM sync_pack_target_state WHERE pack_id = ?1",
            "DELETE FROM sync_pack_mods WHERE pack_id = ?1",
            "DELETE FROM sync_pack_mod_resolutions WHERE pack_id = ?1",
            "DELETE FROM sync_pack_targets WHERE pack_id = ?1",
            "DELETE FROM sync_packs WHERE id = ?1",
        ] {
            sqlx::query(stmt)
                .bind(&key)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit()
            .await?;

        self.inner.locks.remove(&pack_id);

        let dir = crate::sync::paths::pack_dir(pack_id);
        if dir.exists() {
            match crate::utils::trash_utils::move_path_to_trash(&dir, Some("sync_packs")).await {
                Ok(moved) => info!("Moved sync pack folder to trash: {:?}", moved),
                Err(e) => warn!("Could not move sync pack folder {:?} to trash: {}", dir, e),
            }
        }

        Ok(())
    }

    pub async fn upsert_target(&self, pack_id: Uuid, target: SyncTarget) -> Result<SyncTarget> {
        let pool = self.pool().await?;
        let normalized = crate::sync::paths::validate_target_path(&target.path, &target.kind)?;
        let kind_json = serde_json::to_string(&target.kind)?;

        let stored = SyncTarget {
            id: target.id,
            path: normalized,
            enabled: target.enabled,
            kind: target.kind,
            external_path: target.external_path,
        };

        let mut tx = pool
            .begin()
            .await?;

        sqlx::query("DELETE FROM sync_pack_targets WHERE pack_id = ?1 AND path = ?2 AND id <> ?3")
            .bind(pack_id.to_string())
            .bind(&stored.path)
            .bind(stored.id.to_string())
            .execute(&mut *tx)
            .await?;

        sqlx::query(
            r#"
            INSERT INTO sync_pack_targets (id, pack_id, path, enabled, kind, external_path)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT (id) DO UPDATE
               SET path = excluded.path, enabled = excluded.enabled, kind = excluded.kind,
                   external_path = excluded.external_path
            "#,
        )
        .bind(stored.id.to_string())
        .bind(pack_id.to_string())
        .bind(&stored.path)
        .bind(if stored.enabled { 1_i64 } else { 0_i64 })
        .bind(&kind_json)
        .bind(&stored.external_path)
        .execute(&mut *tx)
        .await?;

        tx.commit()
            .await?;

        self.touch(&pool, pack_id).await;
        Ok(stored)
    }

    pub async fn remove_target(&self, pack_id: Uuid, target_id: Uuid) -> Result<Option<SyncTarget>> {
        let pool = self.pool().await?;
        let row = sqlx::query("SELECT id, pack_id, path, enabled, kind, external_path FROM sync_pack_targets WHERE id = ?1 AND pack_id = ?2")
            .bind(target_id.to_string())
            .bind(pack_id.to_string())
            .fetch_optional(&pool)
            .await?;

        let Some(row) = row else { return Ok(None) };
        let target = Self::row_to_target(&row)?;

        sqlx::query("DELETE FROM sync_pack_targets WHERE id = ?1")
            .bind(target_id.to_string())
            .execute(&pool)
            .await?;

        sqlx::query("DELETE FROM sync_pack_target_state WHERE pack_id = ?1 AND target_path = ?2")
            .bind(pack_id.to_string())
            .bind(&target.path)
            .execute(&pool)
            .await
            .ok();

        sqlx::query("DELETE FROM sync_pack_adoptions WHERE pack_id = ?1 AND target_path = ?2")
            .bind(pack_id.to_string())
            .bind(&target.path)
            .execute(&pool)
            .await
            .ok();

        self.touch(&pool, pack_id).await;
        Ok(Some(target))
    }

    pub async fn add_mods(&self, pack_id: Uuid, mods: &[Mod]) -> Result<()> {
        if mods.is_empty() {
            return Ok(());
        }
        let pool = self.pool().await?;
        let mut tx = pool
            .begin()
            .await?;

        for m in mods {
            let data = serde_json::to_string(m)?;
            sqlx::query(
                r#"
                INSERT INTO sync_pack_mods (pack_id, mod_id, data)
                VALUES (?1, ?2, ?3)
                ON CONFLICT (pack_id, mod_id) DO UPDATE SET data = excluded.data
                "#,
            )
            .bind(pack_id.to_string())
            .bind(m.id.to_string())
            .bind(&data)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit()
            .await?;

        self.touch(&pool, pack_id).await;
        Ok(())
    }

    fn missing_mod(pack_id: Uuid, mod_id: Uuid) -> AppError {
        AppError::Other(format!(
            "Mod {} is not part of sync pack {}",
            mod_id, pack_id
        ))
    }

    async fn mod_field(
        pool: &SqlitePool,
        pack_id: Uuid,
        mod_id: Uuid,
        column: &str,
    ) -> Result<Option<String>> {
        let sql = format!(
            "SELECT {} FROM sync_pack_mods WHERE pack_id = ?1 AND mod_id = ?2",
            column
        );
        let row = sqlx::query(&sql)
            .bind(pack_id.to_string())
            .bind(mod_id.to_string())
            .fetch_optional(pool)
            .await?;
        Ok(row.map(|row| row.get::<String, _>(column)))
    }

    async fn require_mod(pool: &SqlitePool, pack_id: Uuid, mod_id: Uuid) -> Result<Mod> {
        let data = Self::mod_field(pool, pack_id, mod_id, "data")
            .await?
            .ok_or_else(|| Self::missing_mod(pack_id, mod_id))?;
        Ok(serde_json::from_str(&data)?)
    }

    pub async fn remove_mod(&self, pack_id: Uuid, mod_id: Uuid) -> Result<()> {
        self.remove_mods(pack_id, &[mod_id]).await?;
        Ok(())
    }

    pub async fn set_mod_enabled(&self, pack_id: Uuid, mod_id: Uuid, enabled: bool) -> Result<()> {
        self.set_mods_enabled(pack_id, &[mod_id], enabled).await?;
        Ok(())
    }

    pub async fn set_mods_enabled(
        &self,
        pack_id: Uuid,
        mod_ids: &[Uuid],
        enabled: bool,
    ) -> Result<usize> {
        if mod_ids.is_empty() {
            return Ok(0);
        }
        let pool = self.pool().await?;

        let mut changed = Vec::new();
        for mod_id in mod_ids {
            match Self::require_mod(&pool, pack_id, *mod_id).await {
                Ok(mut entry) => {
                    if entry.enabled != enabled {
                        entry.enabled = enabled;
                        changed.push(entry);
                    }
                }
                Err(e) => warn!("Skipping mod {} of pack {}: {}", mod_id, pack_id, e),
            }
        }

        self.add_mods(pack_id, &changed).await?;
        Ok(changed.len())
    }

    pub async fn remove_mods(&self, pack_id: Uuid, mod_ids: &[Uuid]) -> Result<usize> {
        if mod_ids.is_empty() {
            return Ok(0);
        }
        let pool = self.pool().await?;

        let mut keys = Vec::new();
        for mod_id in mod_ids {
            if let Ok(entry) = Self::require_mod(&pool, pack_id, *mod_id).await {
                if let Some(key) = crate::sync::resolution::project_key_of(&entry.source) {
                    keys.push(key);
                }
            }
        }

        let mut removed = 0;
        for chunk in mod_ids.chunks(900) {
            let placeholders = (0..chunk.len())
                .map(|i| format!("?{}", i + 2))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "DELETE FROM sync_pack_mods WHERE pack_id = ?1 AND mod_id IN ({})",
                placeholders
            );
            let mut query = sqlx::query(&sql).bind(pack_id.to_string());
            for mod_id in chunk {
                query = query.bind(mod_id.to_string());
            }
            removed += query.execute(&pool).await?.rows_affected() as usize;
        }

        for key in keys {
            self.clear_mod_resolutions(pack_id, &key).await.ok();
        }

        self.touch(&pool, pack_id).await;
        Ok(removed)
    }

    pub async fn set_mod_version_override(
        &self,
        pack_id: Uuid,
        mod_id: Uuid,
        mc_version: &str,
        value: Option<VersionOverride>,
    ) -> Result<()> {
        let pool = self.pool().await?;
        let raw = Self::mod_field(&pool, pack_id, mod_id, "version_overrides")
            .await?
            .ok_or_else(|| Self::missing_mod(pack_id, mod_id))?;
        let mut overrides: HashMap<String, VersionOverride> =
            serde_json::from_str(&raw).unwrap_or_default();

        match value {
            Some(v) => {
                overrides.insert(mc_version.to_string(), v);
            }
            None => {
                overrides.remove(mc_version);
            }
        }

        let encoded = serde_json::to_string(&overrides)?;

        sqlx::query(
            "UPDATE sync_pack_mods SET version_overrides = ?3 WHERE pack_id = ?1 AND mod_id = ?2",
        )
        .bind(pack_id.to_string())
        .bind(mod_id.to_string())
        .bind(&encoded)
        .execute(&pool)
        .await?;

        self.touch(&pool, pack_id).await;
        Ok(())
    }

    fn row_to_resolution(row: &sqlx::sqlite::SqliteRow) -> ResolvedVersion {
        ResolvedVersion {
            version_id: row.get("version_id"),
            version_name: row.get("version_name"),
            filename: row.get("filename"),
            download_url: row.get("download_url"),
            sha1: row.get("sha1"),
            file_size: row.get("file_size"),
            resolved_at: row.get("resolved_at"),
        }
    }

    pub async fn get_mod_resolutions(
        &self,
        pack_id: Uuid,
    ) -> Result<HashMap<(String, String, String), ResolvedVersion>> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT project_key, mc_version, loader, version_id, version_name, filename,
                   download_url, sha1, file_size, resolved_at
              FROM sync_pack_mod_resolutions
             WHERE pack_id = ?1
            "#,
        )
        .bind(pack_id.to_string())
        .fetch_all(&pool)
        .await?;

        let mut out = HashMap::new();
        for row in &rows {
            let key = (
                row.get::<String, _>("project_key"),
                row.get::<String, _>("mc_version"),
                row.get::<String, _>("loader"),
            );
            out.insert(key, Self::row_to_resolution(row));
        }
        Ok(out)
    }

    pub async fn set_mod_resolution(
        &self,
        pack_id: Uuid,
        project_key: &str,
        mc_version: &str,
        loader: &str,
        resolved: &ResolvedVersion,
    ) -> Result<()> {
        self.set_mod_resolutions(
            pack_id,
            &[(
                project_key.to_string(),
                mc_version.to_string(),
                loader.to_string(),
                resolved.clone(),
            )],
        )
        .await
    }

    pub async fn set_mod_resolutions(
        &self,
        pack_id: Uuid,
        entries: &[(String, String, String, ResolvedVersion)],
    ) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }

        let pool = self.pool().await?;
        let mut tx = pool.begin().await?;

        for (project_key, mc_version, loader, resolved) in entries {
            sqlx::query(
                r#"
                INSERT INTO sync_pack_mod_resolutions
                    (pack_id, project_key, mc_version, loader, version_id, version_name, filename,
                     download_url, sha1, file_size, resolved_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT (pack_id, project_key, mc_version, loader) DO UPDATE
                   SET version_id = excluded.version_id,
                       version_name = excluded.version_name,
                       filename = excluded.filename,
                       download_url = excluded.download_url,
                       sha1 = excluded.sha1,
                       file_size = excluded.file_size,
                       resolved_at = excluded.resolved_at
                "#,
            )
            .bind(pack_id.to_string())
            .bind(project_key)
            .bind(mc_version)
            .bind(loader)
            .bind(&resolved.version_id)
            .bind(&resolved.version_name)
            .bind(&resolved.filename)
            .bind(&resolved.download_url)
            .bind(&resolved.sha1)
            .bind(resolved.file_size)
            .bind(resolved.resolved_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn clear_mod_resolutions(&self, pack_id: Uuid, project_key: &str) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query(
            "DELETE FROM sync_pack_mod_resolutions WHERE pack_id = ?1 AND project_key = ?2",
        )
        .bind(pack_id.to_string())
        .bind(project_key)
        .execute(&pool)
        .await?;
        Ok(())
    }

    pub async fn get_target_state(&self, pack_id: Uuid, target_path: &str) -> Result<SyncTargetState> {
        let pool = self.pool().await?;
        let row = sqlx::query(
            "SELECT last_sync, content_sha1, last_source_profile FROM sync_pack_target_state WHERE pack_id = ?1 AND target_path = ?2",
        )
        .bind(pack_id.to_string())
        .bind(target_path)
        .fetch_optional(&pool)
        .await?;

        let Some(row) = row else { return Ok(SyncTargetState::default()) };
        let last_source: Option<String> = row.get("last_source_profile");

        Ok(SyncTargetState {
            last_sync: row.get("last_sync"),
            content_sha1: row.get("content_sha1"),
            last_source_profile: last_source.and_then(|s| Uuid::parse_str(&s).ok()),
        })
    }

    pub async fn set_target_state(
        &self,
        pack_id: Uuid,
        target_path: &str,
        state: &SyncTargetState,
    ) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query(
            r#"
            INSERT INTO sync_pack_target_state (pack_id, target_path, last_sync, content_sha1, last_source_profile)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT (pack_id, target_path) DO UPDATE
               SET last_sync = excluded.last_sync,
                   content_sha1 = excluded.content_sha1,
                   last_source_profile = excluded.last_source_profile
            "#,
        )
        .bind(pack_id.to_string())
        .bind(target_path)
        .bind(state.last_sync)
        .bind(&state.content_sha1)
        .bind(state.last_source_profile.map(|id| id.to_string()))
        .execute(&pool)
        .await?;
        Ok(())
    }

    pub async fn is_adopted(&self, pack_id: Uuid, target_path: &str, profile_id: Uuid) -> Result<bool> {
        let pool = self.pool().await?;
        let row = sqlx::query(
            "SELECT 1 AS hit FROM sync_pack_adoptions WHERE pack_id = ?1 AND target_path = ?2 AND profile_id = ?3",
        )
        .bind(pack_id.to_string())
        .bind(target_path)
        .bind(profile_id.to_string())
        .fetch_optional(&pool)
        .await?;
        Ok(row.is_some())
    }

    pub async fn mark_adopted(&self, pack_id: Uuid, target_path: &str, profile_id: Uuid) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query(
            "INSERT OR IGNORE INTO sync_pack_adoptions (pack_id, target_path, profile_id) VALUES (?1, ?2, ?3)",
        )
        .bind(pack_id.to_string())
        .bind(target_path)
        .bind(profile_id.to_string())
        .execute(&pool)
        .await?;
        Ok(())
    }

    pub async fn clear_adoption(&self, pack_id: Uuid, target_path: &str, profile_id: Uuid) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query(
            "DELETE FROM sync_pack_adoptions WHERE pack_id = ?1 AND target_path = ?2 AND profile_id = ?3",
        )
        .bind(pack_id.to_string())
        .bind(target_path)
        .bind(profile_id.to_string())
        .execute(&pool)
        .await?;
        Ok(())
    }

    pub async fn clear_adoptions_for_profile(&self, profile_id: Uuid) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query("DELETE FROM sync_pack_adoptions WHERE profile_id = ?1")
            .bind(profile_id.to_string())
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn reap_orphans(&self) -> Result<()> {
        let pool = self.pool().await?;
        let rows = sqlx::query("SELECT id FROM sync_packs")
            .fetch_all(&pool)
            .await?;

        let known: Vec<String> = rows.iter().map(|r| r.get::<String, _>("id")).collect();
        let known_json = serde_json::to_string(&known)?;

        for stmt in [
            "DELETE FROM sync_pack_targets WHERE pack_id NOT IN (SELECT value FROM json_each(?1))",
            "DELETE FROM sync_pack_mods WHERE pack_id NOT IN (SELECT value FROM json_each(?1))",
            "DELETE FROM sync_pack_mod_resolutions WHERE pack_id NOT IN (SELECT value FROM json_each(?1))",
            "DELETE FROM sync_pack_target_state WHERE pack_id NOT IN (SELECT value FROM json_each(?1))",
            "DELETE FROM sync_pack_adoptions WHERE pack_id NOT IN (SELECT value FROM json_each(?1))",
        ] {
            if let Err(e) = sqlx::query(stmt).bind(&known_json).execute(&pool).await {
                warn!("Sync pack orphan sweep failed: {}", e);
            }
        }

        let known_ids: Vec<Uuid> = known.iter().filter_map(|s| Uuid::parse_str(s).ok()).collect();
        let state = crate::state::state_manager::State::get().await?;
        let profiles = state.profile_manager.list_profiles().await?;

        for profile in profiles {
            if profile.sync_pack_ids.is_empty() {
                continue;
            }
            let kept: Vec<Uuid> = profile
                .sync_pack_ids
                .iter()
                .copied()
                .filter(|id| known_ids.contains(id))
                .collect();
            if kept.len() == profile.sync_pack_ids.len() {
                continue;
            }
            let profile_id = profile.id;
            let mut updated = profile;
            debug!(
                "Dropping {} orphaned sync pack subscription(s) from profile {}",
                updated.sync_pack_ids.len() - kept.len(),
                profile_id
            );
            updated.sync_pack_ids = kept;
            if let Err(e) = state.profile_manager.update_profile(profile_id, updated).await {
                warn!("Could not persist orphan sweep for profile {}: {}", profile_id, e);
            }
        }

        Ok(())
    }
}

#[async_trait]
impl PostInitializationHandler for SyncPackManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        if !self.is_available().await {
            warn!("Sync packs are disabled: the launcher database is not available");
            return Ok(());
        }

        if let Err(e) = tokio::fs::create_dir_all(crate::sync::paths::sync_packs_root()).await {
            warn!("Could not create the sync packs directory: {}", e);
        }

        let this = self.clone();
        tokio::spawn(async move {
            if let Err(e) = this.reap_orphans().await {
                warn!("Sync pack orphan reap failed: {}", e);
            }
        });

        Ok(())
    }
}
