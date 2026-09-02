
use crate::error::{AppError, Result};
use crate::state::db::{self, DbHandle};
use crate::state::profile_state::{
    Mod, ModLoader, NoriskModIdentifier, Profile, ProfileSettings, ProfileState,
};
use chrono::{DateTime, Utc};
use log::warn;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const SQL_VARIABLE_CHUNK: usize = 900;

pub struct ProfileStore {
    db: DbHandle,
}

fn tag_of<T: Serialize>(value: &T) -> Result<String> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(s) => Ok(s),
        other => Err(AppError::Other(format!(
            "Expected a string tag, got {}",
            other
        ))),
    }
}

fn tag_into<T: DeserializeOwned>(raw: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(raw.to_string())).ok()
}

fn json_of<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}

fn json_into<T: DeserializeOwned + Default>(raw: &str, what: &str) -> T {
    serde_json::from_str(raw).unwrap_or_else(|e| {
        warn!("Could not read the stored {}: {}", what, e);
        T::default()
    })
}

fn json_option<T: DeserializeOwned>(raw: Option<String>, what: &str) -> Option<T> {
    let raw = raw?;
    match serde_json::from_str(&raw) {
        Ok(value) => Some(value),
        Err(e) => {
            warn!("Could not read the stored {}: {}", what, e);
            None
        }
    }
}

fn nanos_of(at: &DateTime<Utc>) -> i64 {
    at.timestamp_nanos_opt()
        .unwrap_or_else(|| at.timestamp_millis().saturating_mul(1_000_000))
}

fn nanos_into(raw: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_nanos(raw)
}

pub fn canonical_value(profile: &Profile) -> Result<serde_json::Value> {
    let mut value = serde_json::to_value(profile)?;
    if let Some(set) = value
        .get_mut("disabled_norisk_mods_detailed")
        .and_then(|v| v.as_array_mut())
    {
        set.sort_by_key(|entry| entry.to_string());
    }
    Ok(value)
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

#[derive(serde::Deserialize, Default)]
struct SettingsData {
    #[serde(default)]
    java_path: Option<String>,
    #[serde(default)]
    use_custom_java_path: bool,
    #[serde(default)]
    use_overwrite_loader_version: bool,
    #[serde(default)]
    overwrite_loader_version: Option<String>,
    #[serde(default)]
    overwrite_loader_versions: HashMap<String, String>,
    #[serde(default)]
    memory: Option<crate::state::profile_state::MemorySettings>,
    #[serde(default)]
    resolution: Option<crate::state::profile_state::WindowSize>,
    #[serde(default)]
    fullscreen: bool,
    #[serde(default)]
    extra_game_args: Vec<String>,
    #[serde(default)]
    custom_jvm_args: Option<String>,
    #[serde(default)]
    quick_play_path: Option<String>,
}

impl From<SettingsData> for ProfileSettings {
    fn from(data: SettingsData) -> Self {
        let defaults = ProfileSettings::default();
        ProfileSettings {
            java_path: data.java_path,
            use_custom_java_path: data.use_custom_java_path,
            use_overwrite_loader_version: data.use_overwrite_loader_version,
            overwrite_loader_version: data.overwrite_loader_version,
            overwrite_loader_versions: data.overwrite_loader_versions,
            memory: data.memory.unwrap_or(defaults.memory),
            resolution: data.resolution,
            fullscreen: data.fullscreen,
            extra_game_args: data.extra_game_args,
            custom_jvm_args: data.custom_jvm_args,
            quick_play_path: data.quick_play_path,
        }
    }
}

pub fn row_to_profile(row: &sqlx::sqlite::SqliteRow) -> Result<Profile> {
    let raw_id: String = row.get("id");
    let id = Uuid::parse_str(&raw_id)
        .map_err(|e| AppError::Other(format!("Invalid profile id '{}': {}", raw_id, e)))?;

    let loader_raw: String = row.get("loader");
    let state_raw: String = row.get("state");

    let settings: SettingsData = json_into(&row.get::<String, _>("settings"), "profile settings");

    Ok(Profile {
        sync_pack_ids: Vec::new(),
        id,
        name: row.get("name"),
        path: row.get("path"),
        game_version: row.get("game_version"),
        loader: tag_into(&loader_raw).unwrap_or_else(|| {
            warn!("Unknown loader '{}' on profile {}", loader_raw, id);
            ModLoader::Vanilla
        }),
        loader_version: row.get("loader_version"),
        created: nanos_into(row.get::<i64, _>("created")),
        last_played: row.get::<Option<i64>, _>("last_played").map(nanos_into),
        settings: settings.into(),
        state: tag_into(&state_raw).unwrap_or_else(|| {
            warn!("Unknown state '{}' on profile {}", state_raw, id);
            ProfileState::NotInstalled
        }),
        mods: Vec::new(),
        selected_norisk_pack_id: row.get("selected_norisk_pack_id"),
        disabled_norisk_mods_detailed: HashSet::new(),
        source_standard_profile_id: parse_optional_uuid(row.get("source_standard_profile_id")),
        group: row.get("group_name"),
        use_shared_minecraft_folder: row.get::<i64, _>("use_shared_minecraft_folder") != 0,
        is_standard_version: row.get::<i64, _>("is_standard_version") != 0,
        description: row.get("description"),
        banner: json_option(row.get("banner"), "banner"),
        background: json_option(row.get("background"), "background"),
        norisk_information: json_option(row.get("norisk_information"), "norisk information"),
        modpack_info: json_option(row.get("modpack_info"), "modpack info"),
        preferred_account_id: parse_optional_uuid(row.get("preferred_account_id")),
        playtime_seconds: row.get::<i64, _>("playtime_seconds").max(0) as u64,
        extra: json_into(&row.get::<String, _>("extra"), "extra profile keys"),
    })
}

fn parse_optional_uuid(raw: Option<String>) -> Option<Uuid> {
    let raw = raw?;
    match Uuid::parse_str(&raw) {
        Ok(id) => Some(id),
        Err(e) => {
            warn!("Ignoring unparseable uuid '{}': {}", raw, e);
            None
        }
    }
}

pub fn row_to_mod(row: &sqlx::sqlite::SqliteRow) -> Result<(Uuid, Mod)> {
    let raw_profile: String = row.get("profile_id");
    let profile_id = Uuid::parse_str(&raw_profile)
        .map_err(|e| AppError::Other(format!("Invalid profile id '{}': {}", raw_profile, e)))?;

    let raw_id: String = row.get("id");
    let id = Uuid::parse_str(&raw_id)
        .map_err(|e| AppError::Other(format!("Invalid mod id '{}': {}", raw_id, e)))?;

    let source = serde_json::from_str(&row.get::<String, _>("source"))?;
    let loader_raw: Option<String> = row.get("associated_loader");

    Ok((
        profile_id,
        Mod {
            id,
            source,
            enabled: row.get::<i64, _>("enabled") != 0,
            display_name: row.get("display_name"),
            version: row.get("version"),
            game_versions: json_option(row.get("game_versions"), "mod game versions"),
            file_name_override: row.get("file_name_override"),
            associated_loader: loader_raw.as_deref().and_then(tag_into),
            modpack_origin: row.get("modpack_origin"),
            updates_enabled: row.get::<i64, _>("updates_enabled") != 0,
            force_include_versions: json_into(
                &row.get::<String, _>("force_include_versions"),
                "forced mod versions",
            ),
            extra: json_into(&row.get::<String, _>("extra"), "extra mod keys"),
        },
    ))
}

pub fn row_to_disabled(row: &sqlx::sqlite::SqliteRow) -> Result<(Uuid, NoriskModIdentifier)> {
    let raw_profile: String = row.get("profile_id");
    let profile_id = Uuid::parse_str(&raw_profile)
        .map_err(|e| AppError::Other(format!("Invalid profile id '{}': {}", raw_profile, e)))?;

    let loader_raw: String = row.get("loader");
    let Some(loader) = tag_into(&loader_raw) else {
        return Err(AppError::Other(format!(
            "Unknown loader '{}' on a disabled norisk mod",
            loader_raw
        )));
    };

    Ok((
        profile_id,
        NoriskModIdentifier {
            pack_id: row.get("pack_id"),
            mod_id: row.get("mod_id"),
            game_version: row.get("game_version"),
            loader,
        },
    ))
}

pub fn source_lookup(
    source: &crate::state::profile_state::ModSource,
) -> (String, Option<String>, Option<String>, Option<String>) {
    use crate::state::profile_state::ModSource;
    match source {
        ModSource::Local { file_name } => {
            ("local".into(), None, None, Some(file_name.clone()))
        }
        ModSource::Url { file_name, .. } => ("url".into(), None, None, file_name.clone()),
        ModSource::Maven { coordinates, .. } => {
            ("maven".into(), Some(coordinates.clone()), None, None)
        }
        ModSource::Embedded { name } => ("embedded".into(), Some(name.clone()), None, None),
        ModSource::Modrinth {
            project_id,
            version_id,
            file_name,
            ..
        } => (
            "modrinth".into(),
            Some(project_id.clone()),
            Some(version_id.clone()),
            Some(file_name.clone()),
        ),
        ModSource::CurseForge {
            project_id,
            file_id,
            file_name,
            ..
        } => (
            "curse_forge".into(),
            Some(project_id.clone()),
            Some(file_id.clone()),
            Some(file_name.clone()),
        ),
    }
}

impl ProfileStore {
    pub fn new(db: DbHandle) -> Self {
        Self { db }
    }

    pub async fn pool(&self) -> Result<SqlitePool> {
        match db::pool_of(&self.db).await {
            Some(pool) => Ok(pool),
            None => Err(AppError::Other(
                "The launcher database is not available, profiles cannot be read or written"
                    .to_string(),
            )),
        }
    }

    pub async fn counts(&self) -> Result<(i64, i64)> {
        let pool = self.pool().await?;
        let profiles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
            .fetch_one(&pool)
            .await?;
        let mods: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_mods")
            .fetch_one(&pool)
            .await?;
        Ok((profiles, mods))
    }

    pub async fn load_all(&self) -> Result<HashMap<Uuid, Profile>> {
        let pool = self.pool().await?;

        let mut profiles: HashMap<Uuid, Profile> = HashMap::new();
        for row in sqlx::query("SELECT * FROM profiles").fetch_all(&pool).await? {
            match row_to_profile(&row) {
                Ok(profile) => {
                    profiles.insert(profile.id, profile);
                }
                Err(e) => warn!("Skipping an unreadable profile row: {}", e),
            }
        }

        for row in sqlx::query("SELECT * FROM profile_mods ORDER BY profile_id, ordinal")
            .fetch_all(&pool)
            .await?
        {
            match row_to_mod(&row) {
                Ok((profile_id, entry)) => {
                    if let Some(profile) = profiles.get_mut(&profile_id) {
                        profile.mods.push(entry);
                    }
                }
                Err(e) => warn!("Skipping an unreadable mod row: {}", e),
            }
        }

        for row in
            sqlx::query("SELECT * FROM profile_sync_packs ORDER BY profile_id, ordinal")
                .fetch_all(&pool)
                .await?
        {
            let profile_id: String = row.get("profile_id");
            let pack_id: String = row.get("pack_id");
            match (Uuid::parse_str(&profile_id), Uuid::parse_str(&pack_id)) {
                (Ok(profile_id), Ok(pack_id)) => {
                    if let Some(profile) = profiles.get_mut(&profile_id) {
                        profile.sync_pack_ids.push(pack_id);
                    }
                }
                _ => warn!("Skipping an unreadable sync pack link"),
            }
        }

        for row in sqlx::query("SELECT * FROM profile_disabled_norisk_mods")
            .fetch_all(&pool)
            .await?
        {
            match row_to_disabled(&row) {
                Ok((profile_id, identifier)) => {
                    if let Some(profile) = profiles.get_mut(&profile_id) {
                        profile.disabled_norisk_mods_detailed.insert(identifier);
                    }
                }
                Err(e) => warn!("Skipping an unreadable disabled-mod row: {}", e),
            }
        }

        Ok(profiles)
    }

    pub async fn upsert_many(&self, profiles: &[Profile]) -> Result<()> {
        if profiles.is_empty() {
            return Ok(());
        }
        let mut perf = crate::utils::perf_utils::Phase::start("store_upsert");
        let pool = self.pool().await?;
        perf.mark("pool");
        let mut tx = pool.begin().await?;
        for profile in profiles {
            write_profile(&mut tx, profile).await?;
        }
        perf.mark(&format!("write {} profiles", profiles.len()));
        tx.commit().await?;
        perf.mark("commit");
        Ok(())
    }

    async fn set_mod_flag(
        &self,
        profile_id: Uuid,
        ids: &[Uuid],
        column: &'static str,
        value: bool,
    ) -> Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let pool = self.pool().await?;
        let mut changed = 0;

        for chunk in ids.chunks(SQL_VARIABLE_CHUNK) {
            let placeholders = (0..chunk.len())
                .map(|i| format!("?{}", i + 3))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "UPDATE profile_mods SET {} = ?2 WHERE profile_id = ?1 AND id IN ({})",
                column, placeholders
            );
            let mut query = sqlx::query(&sql)
                .bind(profile_id.to_string())
                .bind(value as i64);
            for id in chunk {
                query = query.bind(id.to_string());
            }
            changed += query.execute(&pool).await?.rows_affected();
        }

        Ok(changed)
    }

    pub async fn set_mods_enabled(
        &self,
        profile_id: Uuid,
        ids: &[Uuid],
        enabled: bool,
    ) -> Result<u64> {
        self.set_mod_flag(profile_id, ids, "enabled", enabled).await
    }

    pub async fn set_mods_updates_enabled(
        &self,
        profile_id: Uuid,
        ids: &[Uuid],
        updates_enabled: bool,
    ) -> Result<u64> {
        self.set_mod_flag(profile_id, ids, "updates_enabled", updates_enabled)
            .await
    }

    pub async fn delete_mods(&self, profile_id: Uuid, ids: &[Uuid]) -> Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let pool = self.pool().await?;
        let mut removed = 0;

        for chunk in ids.chunks(SQL_VARIABLE_CHUNK) {
            let placeholders = (0..chunk.len())
                .map(|i| format!("?{}", i + 2))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "DELETE FROM profile_mods WHERE profile_id = ?1 AND id IN ({})",
                placeholders
            );
            let mut query = sqlx::query(&sql).bind(profile_id.to_string());
            for id in chunk {
                query = query.bind(id.to_string());
            }
            removed += query.execute(&pool).await?.rows_affected();
        }

        Ok(removed)
    }

    pub async fn set_norisk_mod_statuses(
        &self,
        profile_id: Uuid,
        entries: &[(NoriskModIdentifier, bool)],
    ) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }
        let pool = self.pool().await?;
        let mut tx = pool.begin().await?;

        for (identifier, enabled) in entries {
            let sql = if *enabled {
                "DELETE FROM profile_disabled_norisk_mods
                  WHERE profile_id = ?1 AND pack_id = ?2 AND mod_id = ?3
                    AND game_version = ?4 AND loader = ?5"
            } else {
                "INSERT OR IGNORE INTO profile_disabled_norisk_mods
                     (profile_id, pack_id, mod_id, game_version, loader)
                 VALUES (?1, ?2, ?3, ?4, ?5)"
            };
            sqlx::query(sql)
                .bind(profile_id.to_string())
                .bind(&identifier.pack_id)
                .bind(&identifier.mod_id)
                .bind(&identifier.game_version)
                .bind(tag_of(&identifier.loader)?)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn upsert_mods(&self, profile_id: Uuid, entries: &[(usize, Mod)]) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }
        let pool = self.pool().await?;
        let mut tx = pool.begin().await?;
        let id = profile_id.to_string();
        for (ordinal, entry) in entries {
            write_mod(&mut tx, &id, *ordinal, entry).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn set_sync_pack_ids(&self, profile_id: Uuid, pack_ids: &[Uuid]) -> Result<()> {
        let pool = self.pool().await?;
        let mut tx = pool.begin().await?;

        sqlx::query("DELETE FROM profile_sync_packs WHERE profile_id = ?1")
            .bind(profile_id.to_string())
            .execute(&mut *tx)
            .await?;

        for (ordinal, pack_id) in pack_ids.iter().enumerate() {
            sqlx::query(
                "INSERT OR IGNORE INTO profile_sync_packs (profile_id, pack_id, ordinal)
                 VALUES (?1, ?2, ?3)",
            )
            .bind(profile_id.to_string())
            .bind(pack_id.to_string())
            .bind(ordinal as i64)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn delete_profile(&self, id: Uuid) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query("DELETE FROM profiles WHERE id = ?1")
            .bind(id.to_string())
            .execute(&pool)
            .await?;
        Ok(())
    }

    pub async fn add_playtime(&self, id: Uuid, seconds: u64) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query(
            "UPDATE profiles SET playtime_seconds = playtime_seconds + ?2 WHERE id = ?1",
        )
        .bind(id.to_string())
        .bind(saturating_i64(seconds))
        .execute(&pool)
        .await?;
        Ok(())
    }

    pub async fn get_meta(&self, key: &str) -> Result<Option<String>> {
        let pool = self.pool().await?;
        Ok(
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = ?1")
                .bind(key)
                .fetch_optional(&pool)
                .await?,
        )
    }
}

async fn write_mod(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    profile_id: &str,
    ordinal: usize,
    entry: &Mod,
) -> Result<()> {
    let (source_type, project_id, version_id, file_name) = source_lookup(&entry.source);
    sqlx::query(
        r#"
        INSERT INTO profile_mods (
            profile_id, id, ordinal, source, source_type, project_id, version_id,
            file_name, enabled, display_name, version, game_versions,
            file_name_override, associated_loader, modpack_origin, updates_enabled,
            force_include_versions, extra
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
        ON CONFLICT (profile_id, id) DO UPDATE SET
            ordinal = excluded.ordinal,
            source = excluded.source,
            source_type = excluded.source_type,
            project_id = excluded.project_id,
            version_id = excluded.version_id,
            file_name = excluded.file_name,
            enabled = excluded.enabled,
            display_name = excluded.display_name,
            version = excluded.version,
            game_versions = excluded.game_versions,
            file_name_override = excluded.file_name_override,
            associated_loader = excluded.associated_loader,
            modpack_origin = excluded.modpack_origin,
            updates_enabled = excluded.updates_enabled,
            force_include_versions = excluded.force_include_versions,
            extra = excluded.extra
        "#,
    )
    .bind(profile_id)
    .bind(entry.id.to_string())
    .bind(ordinal as i64)
    .bind(json_of(&entry.source)?)
    .bind(source_type)
    .bind(project_id)
    .bind(version_id)
    .bind(file_name)
    .bind(entry.enabled as i64)
    .bind(&entry.display_name)
    .bind(&entry.version)
    .bind(entry.game_versions.as_ref().map(json_of).transpose()?)
    .bind(&entry.file_name_override)
    .bind(entry.associated_loader.as_ref().map(tag_of).transpose()?)
    .bind(&entry.modpack_origin)
    .bind(entry.updates_enabled as i64)
    .bind(json_of(&entry.force_include_versions)?)
    .bind(json_of(&entry.extra)?)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn write_profile(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    profile: &Profile,
) -> Result<()> {
    let id = profile.id.to_string();

    sqlx::query(
        r#"
        INSERT INTO profiles (
            id, name, path, game_version, loader, loader_version, created, last_played,
            state, selected_norisk_pack_id, source_standard_profile_id, group_name,
            use_shared_minecraft_folder, is_standard_version, description,
            preferred_account_id, playtime_seconds, settings, banner, background,
            norisk_information, modpack_info, extra, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
            ?18, ?19, ?20, ?21, ?22, ?23, ?24
        )
        ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            path = excluded.path,
            game_version = excluded.game_version,
            loader = excluded.loader,
            loader_version = excluded.loader_version,
            created = excluded.created,
            last_played = excluded.last_played,
            state = excluded.state,
            selected_norisk_pack_id = excluded.selected_norisk_pack_id,
            source_standard_profile_id = excluded.source_standard_profile_id,
            group_name = excluded.group_name,
            use_shared_minecraft_folder = excluded.use_shared_minecraft_folder,
            is_standard_version = excluded.is_standard_version,
            description = excluded.description,
            preferred_account_id = excluded.preferred_account_id,
            playtime_seconds = excluded.playtime_seconds,
            settings = excluded.settings,
            banner = excluded.banner,
            background = excluded.background,
            norisk_information = excluded.norisk_information,
            modpack_info = excluded.modpack_info,
            extra = excluded.extra,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&id)
    .bind(&profile.name)
    .bind(&profile.path)
    .bind(&profile.game_version)
    .bind(tag_of(&profile.loader)?)
    .bind(&profile.loader_version)
    .bind(nanos_of(&profile.created))
    .bind(profile.last_played.as_ref().map(nanos_of))
    .bind(tag_of(&profile.state)?)
    .bind(&profile.selected_norisk_pack_id)
    .bind(profile.source_standard_profile_id.map(|v| v.to_string()))
    .bind(&profile.group)
    .bind(profile.use_shared_minecraft_folder as i64)
    .bind(profile.is_standard_version as i64)
    .bind(&profile.description)
    .bind(profile.preferred_account_id.map(|v| v.to_string()))
    .bind(saturating_i64(profile.playtime_seconds))
    .bind(json_of(&profile.settings)?)
    .bind(profile.banner.as_ref().map(json_of).transpose()?)
    .bind(profile.background.as_ref().map(json_of).transpose()?)
    .bind(profile.norisk_information.as_ref().map(json_of).transpose()?)
    .bind(profile.modpack_info.as_ref().map(json_of).transpose()?)
    .bind(json_of(&profile.extra)?)
    .bind(Utc::now().timestamp_millis())
    .execute(&mut **tx)
    .await?;

    sqlx::query("DELETE FROM profile_mods WHERE profile_id = ?1")
        .bind(&id)
        .execute(&mut **tx)
        .await?;

    for (ordinal, entry) in profile.mods.iter().enumerate() {
        write_mod(tx, &id, ordinal, entry).await?;
    }

    sqlx::query("DELETE FROM profile_sync_packs WHERE profile_id = ?1")
        .bind(&id)
        .execute(&mut **tx)
        .await?;

    for (ordinal, pack_id) in profile.sync_pack_ids.iter().enumerate() {
        sqlx::query(
            "INSERT OR IGNORE INTO profile_sync_packs (profile_id, pack_id, ordinal)
             VALUES (?1, ?2, ?3)",
        )
        .bind(&id)
        .bind(pack_id.to_string())
        .bind(ordinal as i64)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query("DELETE FROM profile_disabled_norisk_mods WHERE profile_id = ?1")
        .bind(&id)
        .execute(&mut **tx)
        .await?;

    for identifier in &profile.disabled_norisk_mods_detailed {
        sqlx::query(
            "INSERT OR IGNORE INTO profile_disabled_norisk_mods
                 (profile_id, pack_id, mod_id, game_version, loader)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&id)
        .bind(&identifier.pack_id)
        .bind(&identifier.mod_id)
        .bind(&identifier.game_version)
        .bind(tag_of(&identifier.loader)?)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub const META_SOURCE: &str = "profiles_source";
pub const SOURCE_SQLITE: &str = "sqlite";

#[derive(Debug, Default, PartialEq)]
pub struct ImportOutcome {
    pub imported: usize,
    pub unparsed: usize,
    pub mods: usize,
}

impl ProfileStore {
    pub async fn is_migrated(&self) -> Result<bool> {
        Ok(self.get_meta(META_SOURCE).await?.as_deref() == Some(SOURCE_SQLITE))
    }

    pub async fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)")
            .bind(key)
            .bind(value)
            .execute(&pool)
            .await?;
        Ok(())
    }

    pub async fn mark_migrated(&self) -> Result<()> {
        let pool = self.pool().await?;
        sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)")
            .bind(META_SOURCE)
            .bind(SOURCE_SQLITE)
            .execute(&pool)
            .await?;
        Ok(())
    }

    pub async fn import_from_json(&self, raw: &str) -> Result<ImportOutcome> {
        let entries: Vec<serde_json::Value> = serde_json::from_str(raw)?;
        let pool = self.pool().await?;
        let mut tx = pool.begin().await?;
        let now = Utc::now().timestamp_millis();

        for table in [
            "profile_sync_packs",
            "profile_disabled_norisk_mods",
            "profile_mods",
            "profiles",
        ] {
            sqlx::query(&format!("DELETE FROM {}", table))
                .execute(&mut *tx)
                .await?;
        }

        let mut outcome = ImportOutcome::default();
        let mut parsed: Vec<Profile> = Vec::new();
        let mut seen: HashSet<Uuid> = HashSet::new();

        for (ordinal, value) in entries.iter().enumerate() {
            let escrow_id;
            let (parsed_flag, error) = match serde_json::from_value::<Profile>(value.clone()) {
                Ok(profile) => {
                    if !seen.insert(profile.id) {
                        escrow_id = format!("duplicate-{}", ordinal);
                        outcome.unparsed += 1;
                        (0, Some(format!("duplicate profile id {}", profile.id)))
                    } else {
                        escrow_id = profile.id.to_string();
                        outcome.mods += profile.mods.len();
                        parsed.push(profile);
                        (1, None)
                    }
                }
                Err(e) => {
                    escrow_id = format!("unparsed-{}", ordinal);
                    outcome.unparsed += 1;
                    (0, Some(e.to_string()))
                }
            };

            sqlx::query(
                "INSERT OR REPLACE INTO profiles_legacy_import
                     (id, ordinal, raw, parsed, parse_error, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(&escrow_id)
            .bind(ordinal as i64)
            .bind(serde_json::to_string(value)?)
            .bind(parsed_flag)
            .bind(error)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        for profile in &parsed {
            write_profile(&mut tx, profile).await?;
        }
        outcome.imported = parsed.len();

        verify_import(&mut tx, &parsed).await?;

        sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)")
            .bind(META_SOURCE)
            .bind(SOURCE_SQLITE)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(outcome)
    }
}

async fn verify_import(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    expected: &[Profile],
) -> Result<()> {
    let profiles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&mut **tx)
        .await?;
    if profiles != expected.len() as i64 {
        return Err(AppError::Other(format!(
            "Import verification failed: {} profiles went in, {} came out",
            expected.len(),
            profiles
        )));
    }

    let expected_mods: i64 = expected.iter().map(|p| p.mods.len() as i64).sum();
    let mods: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_mods")
        .fetch_one(&mut **tx)
        .await?;
    if mods != expected_mods {
        return Err(AppError::Other(format!(
            "Import verification failed: {} mods went in, {} came out",
            expected_mods, mods
        )));
    }

    let broken: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
             SELECT profile_id FROM profile_mods GROUP BY profile_id
              HAVING MIN(ordinal) <> 0 OR MAX(ordinal) <> COUNT(*) - 1)",
    )
    .fetch_one(&mut **tx)
    .await?;
    if broken != 0 {
        return Err(AppError::Other(format!(
            "Import verification failed: {} profile(s) have a broken mod ordering",
            broken
        )));
    }

    for profile in expected {
        let row = sqlx::query("SELECT * FROM profiles WHERE id = ?1")
            .bind(profile.id.to_string())
            .fetch_one(&mut **tx)
            .await?;
        let mut stored = row_to_profile(&row)?;

        let mod_rows = sqlx::query(
            "SELECT * FROM profile_mods WHERE profile_id = ?1 ORDER BY ordinal",
        )
        .bind(profile.id.to_string())
        .fetch_all(&mut **tx)
        .await?;
        for row in &mod_rows {
            stored.mods.push(row_to_mod(row)?.1);
        }

        let disabled_rows =
            sqlx::query("SELECT * FROM profile_disabled_norisk_mods WHERE profile_id = ?1")
                .bind(profile.id.to_string())
                .fetch_all(&mut **tx)
                .await?;
        for row in &disabled_rows {
            stored.disabled_norisk_mods_detailed.insert(row_to_disabled(row)?.1);
        }

        if canonical_value(profile)? != canonical_value(&stored)? {
            return Err(AppError::Other(format!(
                "Import verification failed: profile '{}' ({}) does not read back identically",
                profile.name, profile.id
            )));
        }
    }

    Ok(())
}
