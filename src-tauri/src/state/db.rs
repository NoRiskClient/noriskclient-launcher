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
    ephemeral: bool,
}

pub type DbHandle = Arc<RwLock<Db>>;

pub fn new_handle() -> DbHandle {
    Arc::new(RwLock::new(Db {
        pool: None,
        path: None,
        ephemeral: false,
    }))
}

pub fn db_path() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join(DB_FILENAME)
}

pub async fn open_or_reopen(handle: &DbHandle) {
    open_or_reopen_at(handle, db_path()).await
}

async fn open_or_reopen_at(handle: &DbHandle, path: PathBuf) {
    {
        let db = handle.read().await;
        if db.pool.is_some() && db.path.as_deref() == Some(path.as_path()) {
            return;
        }
    }

    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            warn!("Could not create database directory {:?}: {}", parent, e);
        }
    }

    let (opened, ephemeral) = init_at(&path).await;

    let old = {
        let mut db = handle.write().await;
        let old = db.pool.take();
        db.pool = opened;
        db.path = Some(path);
        db.ephemeral = ephemeral;
        old
    };

    if let Some(old) = old {
        old.close().await;
        info!("Closed the previous app.db pool");
    }
}

pub async fn pool_of(handle: &DbHandle) -> Option<SqlitePool> {
    handle.read().await.pool.clone()
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
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(30))
        .optimize_on_close(true, None))
}

async fn open(path: &Path, wal: bool) -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(30))
        .connect_with(connect_options(path, wal)?)
        .await
        .map_err(|e| AppError::Other(format!("Failed to open SQLite database: {}", e)))?;

    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::Other(format!("SQLite migration failed: {}", e)))
}

async fn open_in_memory() -> Result<SqlitePool> {
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

async fn init_at(path: &Path) -> (Option<SqlitePool>, bool) {
    match open(path, true).await {
        Ok(pool) => {
            info!("Opened app.db (WAL) at {:?}", path);
            return (Some(pool), false);
        }
        Err(e) => warn!("Opening app.db with WAL failed: {}", e),
    }

    match open(path, false).await {
        Ok(pool) => {
            warn!("Opened app.db without WAL (journal=DELETE) at {:?}", path);
            return (Some(pool), false);
        }
        Err(e) => warn!("Opening app.db without WAL failed too: {}", e),
    }

    match open_in_memory().await {
        Ok(pool) => {
            error!("Falling back to an in-memory database. Caches still work, but anything stored in app.db will be lost when the launcher closes.");
            (Some(pool), true)
        }
        Err(e) => {
            error!("Could not open any database, caching is disabled: {}", e);
            (None, false)
        }
    }
}

pub async fn is_ephemeral(handle: &DbHandle) -> bool {
    handle.read().await.ephemeral
}

#[cfg(test)]
pub(crate) async fn test_pool() -> SqlitePool {
    open_in_memory()
        .await
        .expect("in-memory test database must open")
}

#[cfg(test)]
pub(crate) async fn set_pool_for_test(handle: &DbHandle, pool: SqlitePool) {
    let mut db = handle.write().await;
    db.pool = Some(pool);
    db.path = None;
}

#[cfg(test)]
pub(crate) async fn open_at_for_test(handle: &DbHandle, path: &Path) {
    open_or_reopen_at(handle, path.to_path_buf()).await
}

#[cfg(test)]
#[path = "db_test.rs"]
mod tests;

