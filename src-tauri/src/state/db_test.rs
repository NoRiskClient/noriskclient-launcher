use super::*;
use sqlx::Row;

#[tokio::test]
async fn migrations_apply_and_are_idempotent() {
    let pool = test_pool().await;
    migrate(&pool).await.expect("re-running migrations must be a no-op");
}

#[tokio::test]
async fn schema_is_what_we_think() {
    let pool = test_pool().await;

    let cols = sqlx::query("PRAGMA table_info(cache)")
        .fetch_all(&pool)
        .await
        .unwrap();
    let names: Vec<String> = cols.iter().map(|r| r.get::<String, _>("name")).collect();
    assert_eq!(names, ["id", "data_type", "alias", "data", "expires"]);

    let notnull: HashMap<String, i64> = cols
        .iter()
        .map(|r| (r.get::<String, _>("name"), r.get::<i64, _>("notnull")))
        .collect();
    assert_eq!(notnull["id"], 1);
    assert_eq!(notnull["data_type"], 1);
    assert_eq!(notnull["expires"], 1);
    assert_eq!(notnull["alias"], 0);
    assert_eq!(notnull["data"], 0);

    let indexes = sqlx::query("PRAGMA index_list(cache)")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(
        indexes.iter().any(|r| r.get::<i64, _>("unique") == 1),
        "the (data_type, alias) unique index must exist"
    );
}

#[tokio::test]
async fn in_memory_pool_keeps_one_database() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('a', 'k', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    for _ in 0..5 {
        let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("n");
        assert_eq!(n, 1, "a second connection would see an empty database");
    }
}

use std::collections::HashMap;

#[tokio::test]
async fn data_survives_a_pool_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");

    {
        let pool = open(&path, true).await.expect("WAL open must work on a temp dir");
        sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('k', 't', '\"v\"', 99)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    let pool = open(&path, true).await.expect("reopen must work");
    let data: String = sqlx::query("SELECT data FROM cache WHERE id = 'k'")
        .fetch_one(&pool)
        .await
        .expect("the row must have survived")
        .get("data");
    assert_eq!(data, "\"v\"");
}

#[tokio::test]
async fn works_without_wal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");

    let pool = open(&path, false).await.expect("journal=DELETE must work");
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('k', 't', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("n");
    assert_eq!(n, 1);
}

#[tokio::test]
async fn reopening_at_a_new_path_swaps_the_database() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    let path_a = dir_a.path().join("app.db");
    let path_b = dir_b.path().join("app.db");

    let handle = new_handle();

    open_at_for_test(&handle, &path_a).await;
    let pool = pool_of(&handle).await.unwrap();
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('a', 't', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    open_at_for_test(&handle, &path_b).await;
    let pool = pool_of(&handle).await.unwrap();

    let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("n");
    assert_eq!(n, 0, "the new location must be a fresh, migrated database");

    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('b', 't', '2', 0)")
        .execute(&pool)
        .await
        .unwrap();
    drop(pool);

    assert!(path_b.exists());
    let reopened_a = open(&path_a, true).await.unwrap();
    let ids: Vec<String> = sqlx::query("SELECT id FROM cache")
        .fetch_all(&reopened_a)
        .await
        .unwrap()
        .iter()
        .map(|r| r.get::<String, _>("id"))
        .collect();
    assert_eq!(ids, ["a"], "the old database must not have received the new write");
}

#[tokio::test]
async fn reopening_the_same_path_is_a_noop() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");
    let handle = new_handle();

    open_at_for_test(&handle, &path).await;
    let pool = pool_of(&handle).await.unwrap();
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('keep', 't', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    open_at_for_test(&handle, &path).await;

    let pool = pool_of(&handle).await.unwrap();
    assert!(!pool.is_closed(), "the pool must not have been torn down");

    let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("n");
    assert_eq!(n, 1, "and the data must still be there");
}
