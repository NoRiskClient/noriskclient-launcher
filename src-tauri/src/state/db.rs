use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use log::{error, info, warn};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

pub const DB_FILENAME: &str = "app.db";

pub struct Db {
    pool: Option<SqlitePool>,
    path: Option<PathBuf>,
}

pub type DbHandle = Arc<RwLock<Db>>;

pub fn new_handle() -> DbHandle {
    Arc::new(RwLock::new(Db {
        pool: None,
        path: None,
    }))
}

pub fn db_path() -> PathBuf {
    crate::config::standard_meta_dir().join(DB_FILENAME)
}

pub async fn open_or_reopen(handle: &DbHandle) -> Result<()> {
    let path = db_path();
    adopt_database_from_custom_dir(&path).await;
    open_or_reopen_at(handle, path).await
}

async fn adopt_database_from_custom_dir(target: &Path) {
    let legacy = LAUNCHER_DIRECTORY.meta_dir().join(DB_FILENAME);
    if legacy == target {
        return;
    }
    if tokio::fs::try_exists(target).await.unwrap_or(false) {
        return;
    }
    if !tokio::fs::try_exists(&legacy).await.unwrap_or(false) {
        return;
    }

    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            warn!("Could not create {:?} to adopt the old database: {}", parent, e);
            return;
        }
    }

    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{}", legacy.to_string_lossy(), suffix));
        let to = PathBuf::from(format!("{}{}", target.to_string_lossy(), suffix));
        if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
            continue;
        }
        if let Err(e) = tokio::fs::rename(&from, &to).await {
            warn!("Could not move {:?} to {:?}: {}", from, to, e);
        }
    }

    info!("Adopted the database from {:?} into {:?}", legacy, target);
}

pub async fn open_or_reopen_at(handle: &DbHandle, path: PathBuf) -> Result<()> {
    {
        let db = handle.read().await;
        if db.pool.is_some() && db.path.as_deref() == Some(path.as_path()) {
            return Ok(());
        }
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::Other(format!(
                "Could not create the database directory {:?}: {}",
                parent, e
            ))
        })?;
    }

    let opened = init_at(&path).await?;

    let old = {
        let mut db = handle.write().await;
        let old = db.pool.take();
        db.pool = Some(opened);
        db.path = Some(path);
        old
    };

    if let Some(old) = old {
        old.close().await;
        info!("Closed the previous app.db pool");
    }
    Ok(())
}

pub async fn pool_of(handle: &DbHandle) -> Option<SqlitePool> {
    handle.read().await.pool.clone()
}

pub async fn quarantine_database() -> Result<PathBuf> {
    let path = db_path();
    let stamped = path.with_extension(format!("db.broken.{}", chrono::Utc::now().timestamp()));

    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix));
        if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
            continue;
        }
        let to = PathBuf::from(format!("{}{}", stamped.to_string_lossy(), suffix));
        tokio::fs::rename(&from, &to).await.map_err(|e| {
            AppError::DatabaseUnavailable(
                [
                    "The database could not be moved aside:".to_string(),
                    String::new(),
                    from.display().to_string(),
                    String::new(),
                    e.to_string(),
                    String::new(),
                    concat!(
                        "This almost always means another NoRisk Launcher is still ",
                        "running. Close it and try again."
                    )
                    .to_string(),
                ]
                .join("\n"),
            )
        })?;
    }

    warn!("Moved the unusable database aside to {:?}", stamped);
    Ok(stamped)
}

pub async fn vacuum_into(handle: &DbHandle, destination: &Path) -> Result<()> {
    let Some(pool) = pool_of(handle).await else {
        return Err(AppError::Other(
            "Cannot snapshot the database: it is not backed by a file".to_string(),
        ));
    };

    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if tokio::fs::try_exists(destination).await.unwrap_or(false) {
        tokio::fs::remove_file(destination).await?;
    }

    sqlx::query("VACUUM INTO ?1")
        .bind(destination.to_string_lossy().as_ref())
        .execute(&pool)
        .await?;

    info!("Wrote a database snapshot to {:?}", destination);
    Ok(())
}

fn connect_options(path: &Path, wal: bool) -> Result<SqliteConnectOptions> {
    let uri = format!("sqlite://{}", path.to_string_lossy());

    Ok(SqliteConnectOptions::from_str(&uri)
        .map_err(|e| AppError::Other(format!("Invalid SQLite URI {}: {}", uri, e)))?
        .create_if_missing(true)
        .journal_mode(if wal {
            SqliteJournalMode::Wal
        } else {
            SqliteJournalMode::Delete
        })
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(30))
        .foreign_keys(true)
        .optimize_on_close(true, None))
}

pub async fn open(path: &Path, wal: bool) -> std::result::Result<SqlitePool, String> {
    let options = connect_options(path, wal).map_err(|e| e.to_string())?;
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(30))
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())?;

    migrate(&pool).await.map_err(|e| e.to_string())?;
    Ok(pool)
}

pub async fn migrate(pool: &SqlitePool) -> Result<()> {
    let mut migrator = sqlx::migrate!("./migrations");
    migrator.set_ignore_missing(true);
    migrator
        .run(pool)
        .await
        .map_err(|e| AppError::Other(format!("SQLite migration failed: {}", e)))
}

pub async fn open_in_memory() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .map_err(|e| AppError::Other(format!("Invalid in-memory SQLite URI: {}", e)))?,
        )
        .await
        .map_err(|e| AppError::Other(format!("Failed to open in-memory SQLite: {}", e)))?;

    migrate(&pool).await?;
    Ok(pool)
}

fn describe_open_failure(wal: &str, without_wal: &str) -> String {
    if wal == without_wal {
        return wal.to_string();
    }
    format!("{}
{}", wal, without_wal)
}

async fn init_at(path: &Path) -> Result<SqlitePool> {
    let wal_error = match open(path, true).await {
        Ok(pool) => {
            info!("Opened app.db (WAL) at {:?}", path);
            return Ok(pool);
        }
        Err(e) => {
            warn!("Opening app.db with WAL failed: {}", e);
            e
        }
    };

    match open(path, false).await {
        Ok(pool) => {
            warn!("Opened app.db without WAL (journal=DELETE) at {:?}", path);
            Ok(pool)
        }
        Err(e) => {
            error!(
                "Could not open app.db at {:?} (WAL: {} | journal=DELETE: {})",
                path, wal_error, e
            );
            Err(AppError::DatabaseUnavailable(
                [
                    "Its database could not be opened:".to_string(),
                    path.display().to_string(),
                    describe_open_failure(&wal_error, &e),
                    String::new(),
                    "Your profiles are safe. Nothing has been deleted.".to_string(),
                    String::new(),
                    "First try this:".to_string(),
                    concat!(
                        "Close any other NoRisk Launcher, and pause OneDrive if it ",
                        "syncs this folder. Then start again."
                    )
                    .to_string(),
                ]
                .join("\n"),
            ))
        }
    }
}
