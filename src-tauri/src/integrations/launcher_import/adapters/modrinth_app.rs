use super::super::adapter::{exists, first_existing, is_dir, LauncherAdapter};
use super::super::loader_map;
use super::super::model::*;
use super::super::scan;
use crate::error::{AppError, Result};
use crate::utils::import_safety::check_content_file_name;
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use log::{debug, warn};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow};
use sqlx::{ConnectOptions, Row};
use std::path::{Path, PathBuf};

const DB_FILE: &str = "app.db";
const PROFILES_DIR: &str = "profiles";
const ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

const INSTANCES_QUERY: &str = "SELECT i.id AS instance_id, i.path AS path, i.name AS name, i.icon_path AS icon_path, \
    i.last_played AS last_played, cs.game_version AS game_version, cs.loader AS mod_loader, \
    cs.loader_version AS mod_loader_version, l.modrinth_project_id AS linked_project_id, \
    l.modrinth_version_id AS linked_version_id, \
    json_extract(json(o.overrides), '$.java_path') AS override_java_path, \
    json_extract(json(o.overrides), '$.extra_launch_args') AS override_extra_launch_args \
    FROM instances i \
    LEFT JOIN instance_content_sets cs ON cs.id = i.applied_content_set_id \
    LEFT JOIN instance_links l ON l.instance_id = i.id AND l.link_kind = 'modrinth_modpack' \
    LEFT JOIN instance_launch_overrides o ON o.instance_id = i.id";

const LEGACY_PROFILES_QUERY: &str = "SELECT NULL AS instance_id, path, name, icon_path, game_version, mod_loader, \
    mod_loader_version, linked_project_id, linked_version_id, last_played, override_java_path, \
    override_extra_launch_args FROM profiles";

const FILES_QUERY: &str = "SELECT f.file_name AS file_name, f.enabled AS enabled, f.sha1 AS sha1, \
    e.project_id AS project_id, e.version_id AS version_id \
    FROM instance_files f \
    LEFT JOIN instance_content_entries e ON e.file_id = f.id \
    WHERE f.instance_id = ? AND f.relative_path LIKE 'mods/%' AND f.missing = 0";

struct ProfileRow {
    instance_id: Option<String>,
    path: String,
    name: String,
    icon_path: Option<String>,
    game_version: Option<String>,
    mod_loader: Option<String>,
    mod_loader_version: Option<String>,
    linked_project_id: Option<String>,
    linked_version_id: Option<String>,
    last_played: Option<i64>,
    override_java_path: Option<String>,
    override_extra_launch_args: Vec<String>,
}

impl ProfileRow {
    fn from_row(row: &SqliteRow) -> Option<Self> {
        let args: Option<String> = row.try_get("override_extra_launch_args").ok().flatten();

        Some(Self {
            instance_id: row.try_get("instance_id").ok().flatten(),
            path: row.try_get("path").ok()?,
            name: row.try_get("name").ok()?,
            icon_path: row.try_get("icon_path").ok().flatten(),
            game_version: row.try_get("game_version").ok().flatten(),
            mod_loader: row.try_get("mod_loader").ok().flatten(),
            mod_loader_version: row.try_get("mod_loader_version").ok().flatten(),
            linked_project_id: row.try_get("linked_project_id").ok().flatten(),
            linked_version_id: row.try_get("linked_version_id").ok().flatten(),
            last_played: row.try_get("last_played").ok().flatten(),
            override_java_path: row.try_get("override_java_path").ok().flatten(),
            override_extra_launch_args: args
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_default(),
        })
    }
}

pub struct ModrinthAppAdapter;

impl ModrinthAppAdapter {
    async fn open(root: &Path) -> Result<SqliteConnection> {
        SqliteConnectOptions::new()
            .filename(root.join(DB_FILE))
            .read_only(true)
            .disable_statement_logging()
            .connect()
            .await
            .map_err(|e| AppError::Other(format!("Cannot open Modrinth App database: {}", e)))
    }

    async fn rows(root: &Path) -> Result<Vec<ProfileRow>> {
        let mut connection = Self::open(root).await?;

        let rows = match sqlx::query(INSTANCES_QUERY).fetch_all(&mut connection).await {
            Ok(rows) => rows,
            Err(current) => {
                debug!("Modrinth App has no current schema ({}), trying legacy", current);
                sqlx::query(LEGACY_PROFILES_QUERY)
                    .fetch_all(&mut connection)
                    .await
                    .map_err(|e| {
                        AppError::Other(format!("Cannot read Modrinth App profiles: {}", e))
                    })?
            }
        };

        Ok(rows.iter().filter_map(ProfileRow::from_row).collect())
    }

    async fn declared_mods(root: &Path, instance_id: &str) -> Vec<DeclaredMod> {
        let Ok(mut connection) = Self::open(root).await else {
            return Vec::new();
        };

        let rows = match sqlx::query(FILES_QUERY)
            .bind(instance_id)
            .fetch_all(&mut connection)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                debug!("Modrinth App has no file index for '{}': {}", instance_id, e);
                return Vec::new();
            }
        };

        rows.iter()
            .filter_map(|row| {
                let file_name: String = row.try_get("file_name").ok()?;
                if check_content_file_name(&file_name).is_err() {
                    return None;
                }
                let enabled: bool = row.try_get::<i64, _>("enabled").map(|v| v != 0).unwrap_or(true);
                let sha1: Option<String> = row.try_get("sha1").ok().flatten();
                let project_id: Option<String> = row.try_get("project_id").ok().flatten();
                let version_id: Option<String> = row.try_get("version_id").ok().flatten();

                Some(DeclaredMod {
                    file_name,
                    enabled,
                    modrinth: project_id.zip(version_id),
                    sha1: sha1.filter(|value| !value.trim().is_empty()),
                    ..Default::default()
                })
            })
            .collect()
    }

    async fn row_for(root: &Path, dir: &Path) -> Result<Option<ProfileRow>> {
        let folder = folder_name(dir);
        Ok(Self::rows(root)
            .await?
            .into_iter()
            .find(|row| row.path == folder))
    }

    fn reference_from(root: &LauncherRoot, dir: &Path, row: &ProfileRow) -> ExternalInstanceRef {
        let mut reference = ExternalInstanceRef::new(root, dir, row.name.clone());
        reference.game_version = row
            .game_version
            .clone()
            .filter(|value| !value.trim().is_empty());
        reference.last_played = row.last_played.and_then(timestamp);

        match loader_map::loader_from_name(row.mod_loader.as_deref().unwrap_or("")) {
            Some(loader) => reference.set_loader(loader, row.mod_loader_version.clone()),
            None => reference.mark_unsupported(UnsupportedReason::UnknownLoader),
        }
        if reference.game_version.is_none() {
            reference.mark_unsupported(UnsupportedReason::NoGameVersion);
        }

        reference
    }

    fn reference_without_db(root: &LauncherRoot, dir: &Path) -> ExternalInstanceRef {
        let mut reference = ExternalInstanceRef::new(root, dir, folder_name(dir));
        reference.mark_unsupported(UnsupportedReason::NoGameVersion);
        reference
    }

    async fn icon_for(root: &Path, row: &ProfileRow) -> Option<IconRef> {
        let declared = row
            .icon_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())?;
        let declared_path = PathBuf::from(declared);

        let mut candidates = Vec::new();
        if declared_path.is_absolute() && declared_path.starts_with(root) {
            candidates.push(declared_path.clone());
        }
        for base in ["icons", "caches/icons"] {
            candidates.push(root.join(base).join(declared));
            for extension in ICON_EXTENSIONS {
                candidates.push(root.join(base).join(format!("{}.{}", declared, extension)));
            }
        }

        first_existing(candidates).await.map(IconRef::File)
    }
}

fn timestamp(value: i64) -> Option<DateTime<Utc>> {
    if value <= 0 {
        return None;
    }
    if value > 10_000_000_000 {
        Utc.timestamp_millis_opt(value).single()
    } else {
        Utc.timestamp_opt(value, 0).single()
    }
}

#[async_trait]
impl LauncherAdapter for ModrinthAppAdapter {
    fn kind(&self) -> ExternalLauncher {
        ExternalLauncher::ModrinthApp
    }

    fn candidate_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(data) = dirs::data_dir() {
            roots.push(data.join("ModrinthApp"));
            roots.push(data.join("com.modrinth.theseus"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(
                home.join(".var")
                    .join("app")
                    .join("com.modrinth.ModrinthApp")
                    .join("data")
                    .join("ModrinthApp"),
            );
            roots.push(home.join(".local").join("share").join("ModrinthApp"));
        }
        roots
    }

    async fn probe(&self, root: &Path) -> Option<LauncherRoot> {
        let instances_dir = root.join(PROFILES_DIR);
        if !is_dir(&instances_dir).await {
            return None;
        }

        Some(LauncherRoot {
            launcher: ExternalLauncher::ModrinthApp,
            root: root.to_path_buf(),
            instances_dir,
        })
    }

    fn instance_markers(&self) -> &'static [&'static str] {
        &[]
    }

    async fn list_instances(&self, root: &LauncherRoot) -> Result<Vec<ExternalInstanceRef>> {
        if !exists(&root.instances_dir).await {
            return Err(AppError::Other(format!(
                "Modrinth App has no profiles folder at {}",
                root.instances_dir.display()
            )));
        }

        let rows = match Self::rows(&root.root).await {
            Ok(rows) => rows,
            Err(e) => {
                warn!("Falling back to folder listing for Modrinth App: {}", e);
                Vec::new()
            }
        };

        let mut refs = Vec::new();
        for dir in scan::all_dirs(&root.instances_dir).await {
            let folder = folder_name(&dir);
            match rows.iter().find(|row| row.path == folder) {
                Some(row) => {
                    let mut reference = Self::reference_from(root, &dir, row);
                    reference.icon_path = Self::icon_for(&root.root, row)
                        .await
                        .as_ref()
                        .and_then(IconRef::file_path);
                    refs.push(reference);
                }
                None => {
                    debug!("Modrinth profile '{}' has no database row", folder);
                    refs.push(Self::reference_without_db(root, &dir));
                }
            }
        }

        Ok(refs)
    }

    async fn count_instances(&self, root: &LauncherRoot) -> usize {
        scan::all_dirs(&root.instances_dir).await.len()
    }

    async fn read_instance(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstance> {
        let Some(row) = Self::row_for(&root.root, dir).await? else {
            return Ok(ExternalInstance::new(
                Self::reference_without_db(root, dir),
                dir.to_path_buf(),
            ));
        };

        let reference = Self::reference_from(root, dir, &row);

        let managed_pack = row
            .linked_project_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .map(|project_id| ManagedPackRef::Modrinth {
                project_id,
                version_id: row.linked_version_id.clone(),
            });

        let declared_mods = match row.instance_id.as_deref() {
            Some(instance_id) => Self::declared_mods(&root.root, instance_id).await,
            None => Vec::new(),
        };

        Ok(ExternalInstance {
            icon: Self::icon_for(&root.root, &row).await,
            declared_mods,
            managed_pack,
            untrusted_java_path: row
                .override_java_path
                .clone()
                .filter(|value| !value.trim().is_empty()),
            untrusted_game_args: row.override_extra_launch_args.clone(),
            ..ExternalInstance::new(reference, dir.to_path_buf())
        })
    }
}
