use noriskclient_launcher_v3_lib::state::db::{self, DbHandle};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static SCRATCH: OnceLock<PathBuf> = OnceLock::new();

pub async fn test_pool() -> sqlx::SqlitePool {
    db::open_in_memory()
        .await
        .expect("in-memory test database must open")
}

pub async fn open_at_for_test(handle: &DbHandle, path: &Path) {
    db::open_or_reopen_at(handle, path.to_path_buf())
        .await
        .expect("the test database must open");
}

pub async fn temp_db_handle() -> DbHandle {
    let root = SCRATCH.get_or_init(|| tempfile::tempdir().unwrap().into_path());
    let handle = db::new_handle();
    open_at_for_test(&handle, &root.join(format!("{}.db", uuid::Uuid::new_v4()))).await;
    handle
}
