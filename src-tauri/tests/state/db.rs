use noriskclient_launcher_v3_lib::state::db::*;
use sqlx::Row;

#[tokio::test]
async fn migrations_apply_and_are_idempotent() {
    let pool = crate::harness::test_pool().await;
    migrate(&pool)
        .await
        .expect("re-running migrations must be a no-op");
}

#[tokio::test]
async fn schema_is_what_we_think() {
    let pool = crate::harness::test_pool().await;

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
    let pool = crate::harness::test_pool().await;
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
        let pool = open(&path, true)
            .await
            .expect("WAL open must work on a temp dir");
        sqlx::query(
            "INSERT INTO cache (id, data_type, data, expires) VALUES ('k', 't', '\"v\"', 99)",
        )
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

    crate::harness::open_at_for_test(&handle, &path_a).await;
    let pool = pool_of(&handle).await.unwrap();
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('a', 't', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    crate::harness::open_at_for_test(&handle, &path_b).await;
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
    assert_eq!(
        ids,
        ["a"],
        "the old database must not have received the new write"
    );
}

#[tokio::test]
async fn reopening_the_same_path_is_a_noop() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");
    let handle = new_handle();

    crate::harness::open_at_for_test(&handle, &path).await;
    let pool = pool_of(&handle).await.unwrap();
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('keep', 't', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    crate::harness::open_at_for_test(&handle, &path).await;

    let pool = pool_of(&handle).await.unwrap();
    assert!(!pool.is_closed(), "the pool must not have been torn down");

    let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("n");
    assert_eq!(n, 1, "and the data must still be there");
}

#[tokio::test]
async fn opening_a_file_backed_database_hands_out_a_pool() {
    let dir = tempfile::tempdir().unwrap();
    let handle = new_handle();
    crate::harness::open_at_for_test(&handle, &dir.path().join("app.db")).await;

    assert!(
        pool_of(&handle).await.is_some(),
        "callers must get a pool when the file opened"
    );
}

#[tokio::test]
async fn a_database_that_cannot_be_opened_is_an_error_not_a_ram_disk() {
    let dir = tempfile::tempdir().unwrap();
    let blocked = dir.path().join("app.db");
    std::fs::create_dir(&blocked).expect("a directory where the file should be");

    let handle = new_handle();
    let opened = open_or_reopen_at(&handle, blocked).await;

    assert!(
        opened.is_err(),
        "an unopenable database must fail loudly instead of falling back to memory"
    );
    assert!(
        pool_of(&handle).await.is_none(),
        "a failed open must not leave a usable-looking pool behind"
    );
}

#[tokio::test]
async fn foreign_keys_are_on_so_cascades_actually_fire() {
    let dir = tempfile::tempdir().unwrap();
    let pool = open(&dir.path().join("app.db"), true).await.unwrap();

    let on: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        on, 1,
        "ON DELETE CASCADE must not depend on a driver default"
    );
}

#[tokio::test]
async fn a_snapshot_is_a_readable_copy_of_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let handle = new_handle();
    crate::harness::open_at_for_test(&handle, &dir.path().join("app.db")).await;

    let pool = pool_of(&handle).await.unwrap();
    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('a', 'k', '1', 0)")
        .execute(&pool)
        .await
        .unwrap();

    let snapshot = dir.path().join("snap.db");
    vacuum_into(&handle, &snapshot)
        .await
        .expect("snapshot must succeed");

    let restored = open(&snapshot, true).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cache")
        .fetch_one(&restored)
        .await
        .unwrap();

    assert_eq!(n, 1, "the snapshot must carry the rows that were committed");
}

#[tokio::test]
async fn a_database_that_never_opened_cannot_be_snapshotted() {
    let dir = tempfile::tempdir().unwrap();
    let handle = new_handle();

    assert!(
        vacuum_into(&handle, &dir.path().join("snap.db"))
            .await
            .is_err(),
        "snapshotting nothing would produce a false sense of safety"
    );
}

#[tokio::test]
async fn the_profile_schema_is_what_we_think() {
    let pool = crate::harness::test_pool().await;

    let columns = |table: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query(&format!("PRAGMA table_info({})", table))
                .fetch_all(&pool)
                .await
                .unwrap()
                .iter()
                .map(|r| r.get::<String, _>("name"))
                .collect::<Vec<_>>()
        }
    };

    assert_eq!(
        columns("profiles").await,
        [
            "id",
            "name",
            "path",
            "game_version",
            "loader",
            "loader_version",
            "created",
            "last_played",
            "state",
            "selected_norisk_pack_id",
            "source_standard_profile_id",
            "group_name",
            "use_shared_minecraft_folder",
            "is_standard_version",
            "description",
            "preferred_account_id",
            "playtime_seconds",
            "settings",
            "banner",
            "background",
            "norisk_information",
            "modpack_info",
            "extra",
            "updated_at",
        ]
    );

    assert!(columns("profile_mods")
        .await
        .contains(&"ordinal".to_string()));
    assert!(columns("app_meta").await.contains(&"value".to_string()));
    assert!(columns("profiles_legacy_import")
        .await
        .contains(&"raw".to_string()));
}

#[tokio::test]
async fn one_mod_id_may_belong_to_several_profiles() {
    let pool = crate::harness::test_pool().await;

    for profile in ["p1", "p2"] {
        sqlx::query(
            "INSERT INTO profiles (id, name, path, game_version, loader, created)
             VALUES (?1, 'n', 'p', '1.21.1', 'fabric', 0)",
        )
        .bind(profile)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type)
             VALUES (?1, 'shared-mod', 0, '{}', 'local')",
        )
        .bind(profile)
        .execute(&pool)
        .await
        .unwrap();
    }

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_mods WHERE id = 'shared-mod'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 2, "the same mod id must survive under two profiles");
}

#[tokio::test]
async fn several_profiles_may_share_a_path() {
    let pool = crate::harness::test_pool().await;

    for id in ["a", "b", "c"] {
        sqlx::query(
            "INSERT INTO profiles (id, name, path, game_version, loader, created)
             VALUES (?1, 'n', 'noriskclient/new', '1.21.1', 'fabric', 0)",
        )
        .bind(id)
        .execute(&pool)
        .await
        .expect("a shared path must be allowed");
    }

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 3);
}

#[tokio::test]
async fn deleting_a_profile_takes_its_children() {
    let pool = crate::harness::test_pool().await;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO profiles (id, name, path, game_version, loader, created)
         VALUES ('p', 'n', 'p', '1.21.1', 'fabric', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type)
         VALUES ('p', 'm', 0, '{}', 'local')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO profile_disabled_norisk_mods
             (profile_id, pack_id, mod_id, game_version, loader)
         VALUES ('p', 'pack', 'mod', '1.21.1', 'fabric')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("DELETE FROM profiles WHERE id = 'p'")
        .execute(&pool)
        .await
        .unwrap();

    let mods: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_mods")
        .fetch_one(&pool)
        .await
        .unwrap();
    let disabled: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_disabled_norisk_mods")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        mods, 0,
        "orphaned mod rows would resurrect a deleted profile"
    );
    assert_eq!(disabled, 0);
}

#[tokio::test]
async fn a_migration_from_another_branch_does_not_kill_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");

    let pool = open(&path, true).await.expect("first open must work");
    sqlx::query(
        "INSERT INTO _sqlx_migrations
             (version, description, installed_on, success, checksum, execution_time)
         VALUES (9999, 'from a feature branch', CURRENT_TIMESTAMP, 1, X'00', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let reopened = open(&path, true).await;
    assert!(
        reopened.is_ok(),
        "switching back from a feature branch must not leave a dead database: {:?}",
        reopened.err()
    );

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&reopened.unwrap())
        .await
        .unwrap();
    assert_eq!(n, 0, "the schema must still be usable");
}
