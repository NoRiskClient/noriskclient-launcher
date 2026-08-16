use super::*;
use crate::state::db;

async fn manager() -> ContentCacheManager {
    let handle = db::new_handle();
    db::set_pool_for_test(&handle, db::test_pool().await).await;
    ContentCacheManager::new(handle).unwrap()
}

const K: &str = "test_kind";

#[tokio::test]
async fn roundtrip() {
    let m = manager().await;
    m.put_entry(K, "a", None, Some("hello".to_string()), TTL_METADATA_MS)
        .await;

    let entry = m.get_entry::<String>(K, "a").await.expect("row must exist");
    assert_eq!(entry.data.as_deref(), Some("hello"));
    assert!(entry.is_fresh());
}

#[tokio::test]
async fn negative_entry_is_not_a_miss() {
    let m = manager().await;
    m.put_entry::<String>(K, "known-missing", None, None, TTL_METADATA_MS)
        .await;

    let entry = m.get_entry::<String>(K, "known-missing").await;
    assert!(entry.is_some(), "a negative entry is a hit, not a miss");
    assert!(entry.unwrap().data.is_none());

    assert!(
        m.get_entry::<String>(K, "never-written").await.is_none(),
        "an unwritten key must be a miss"
    );
}

#[tokio::test]
async fn stale_rows_are_still_served() {
    let m = manager().await;
    m.put_entry(K, "old", None, Some("value".to_string()), 0).await;
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;

    let entry = m.get_entry::<String>(K, "old").await.expect("stale row must be returned");
    assert!(!entry.is_fresh(), "and it must report itself as stale");
    assert_eq!(entry.data.as_deref(), Some("value"));
}

#[tokio::test]
async fn alias_is_a_second_lookup_key() {
    let m = manager().await;
    m.put_entry(
        K,
        "AANobbMI",
        Some("sodium".to_string()),
        Some("mod".to_string()),
        TTL_METADATA_MS,
    )
    .await;

    assert!(m.get_entry::<String>(K, "AANobbMI").await.is_some());
    assert!(m.get_entry::<String>(K, "sodium").await.is_some());
    assert!(m.get_entry::<String>(K, "SODIUM").await.is_some());
    assert!(m.get_entry::<String>(K, "aanobbmi").await.is_some());
}

#[tokio::test]
async fn alias_can_be_reassigned() {
    let m = manager().await;
    let alias = Some("shared-slug".to_string());
    m.put_entry(K, "first", alias.clone(), Some("a".to_string()), TTL_METADATA_MS)
        .await;
    m.put_entry(K, "second", alias, Some("b".to_string()), TTL_METADATA_MS)
        .await;

    let by_alias = m.get_entry::<String>(K, "shared-slug").await.expect("alias must resolve");
    assert_eq!(by_alias.data.as_deref(), Some("b"));
    assert!(
        m.get_entry::<String>(K, "first").await.is_none(),
        "the row that lost the alias must be gone, not duplicated"
    );
}

#[tokio::test]
async fn batch_read_exceeds_the_sqlite_variable_limit() {
    let m = manager().await;
    let rows: Vec<Row2Write<String>> = (0..2000)
        .map(|i| Row2Write {
            id: format!("k{i}"),
            alias: None,
            data: Some(format!("v{i}")),
            ttl_ms: TTL_METADATA_MS,
        })
        .collect();
    m.put_entries(K, rows).await;

    let keys: Vec<String> = (0..2000).map(|i| format!("k{i}")).collect();
    let found = m.get_entries::<String>(K, &keys).await;
    assert_eq!(found.len(), 2000);
    assert_eq!(found["k1999"].data.as_deref(), Some("v1999"));
}

#[tokio::test]
async fn undeserializable_row_is_a_miss_and_gets_deleted() {
    let m = manager().await;
    let pool = m.pool().await.unwrap();

    sqlx::query("INSERT INTO cache (id, data_type, data, expires) VALUES ('bad', ?1, 'not json', ?2)")
        .bind(K)
        .bind(i64::MAX)
        .execute(&pool)
        .await
        .unwrap();

    assert!(m.get_entry::<FileHashEntry>(K, "bad").await.is_none());

    let left: i64 = sqlx::query("SELECT COUNT(*) AS n FROM cache WHERE id = 'bad'")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("n");
    assert_eq!(left, 0, "the poisoned row must be deleted");
}

#[tokio::test]
async fn file_hashes_match_on_size_and_mtime() {
    let m = manager().await;
    m.put_file_hashes(vec![(
        "/mods/sodium.jar".to_string(),
        FileHashEntry {
            size: 100,
            mtime_ms: 5,
            sha1: "abc".to_string(),
        },
    )])
    .await;

    assert_eq!(
        m.get_file_hash("/mods/sodium.jar", 100, 5).await.as_deref(),
        Some("abc")
    );
    assert!(m.get_file_hash("/mods/sodium.jar", 100, 6).await.is_none());
    assert!(m.get_file_hash("/mods/sodium.jar", 101, 5).await.is_none());
}

#[tokio::test]
async fn expiry_sweep_spares_file_hashes_and_the_grace_window() {
    let m = manager().await;
    m.put_entry(K, "fresh", None, Some("x".to_string()), TTL_METADATA_MS).await;
    m.put_entry(K, "recently-expired", None, Some("x".to_string()), 0).await;
    m.put_file_hashes(vec![(
        "/some/path".to_string(),
        FileHashEntry { size: 1, mtime_ms: 1, sha1: "h".to_string() },
    )])
    .await;

    assert_eq!(m.delete_expired(STALE_GRACE_MS).await.unwrap(), 0);

    tokio::time::sleep(std::time::Duration::from_millis(5)).await;

    assert_eq!(m.delete_expired(0).await.unwrap(), 1);
    assert!(m.get_entry::<String>(K, "fresh").await.is_some());
    assert!(m.get_file_hash("/some/path", 1, 1).await.is_some());
}

#[tokio::test]
async fn prune_drops_hashes_of_deleted_files() {
    let m = manager().await;
    let dir = tempfile::tempdir().unwrap();
    let alive = dir.path().join("alive.jar");
    std::fs::write(&alive, b"x").unwrap();
    let alive = alive.to_string_lossy().to_string();
    let dead = dir.path().join("gone.jar").to_string_lossy().to_string();

    let entry = FileHashEntry { size: 1, mtime_ms: 1, sha1: "h".to_string() };
    m.put_file_hashes(vec![(alive.clone(), entry.clone()), (dead.clone(), entry)])
        .await;

    assert_eq!(m.prune_missing_files().await.unwrap(), 1);
    assert!(m.get_file_hash(&alive, 1, 1).await.is_some());
    assert!(m.get_file_hash(&dead, 1, 1).await.is_none());
}

#[tokio::test]
async fn key_formats_are_stable() {
    assert_eq!(
        project_versions_cache_key(
            "sodium",
            &Some(vec!["quilt".into(), "fabric".into()]),
            &Some(vec!["1.21".into()])
        ),
        "sodium:fabric,quilt:1.21",
        "loaders must stay sorted"
    );
    assert_eq!(project_versions_cache_key("sodium", &None, &None), "sodium::");

    assert_eq!(
        modpack_cache_key(&ModPackSource::Modrinth {
            project_id: "p".into(),
            version_id: "v".into()
        }),
        "modrinth:p:v"
    );
    assert_eq!(
        modpack_cache_key(&ModPackSource::CurseForge {
            project_id: 1,
            file_id: 2
        }),
        "curseforge:1:2"
    );
}

#[tokio::test]
async fn no_pool_means_miss_not_panic() {
    let m = ContentCacheManager::new(db::new_handle()).unwrap();
    m.put_entry(K, "a", None, Some("x".to_string()), TTL_METADATA_MS).await;
    assert!(m.get_entry::<String>(K, "a").await.is_none());
    assert!(m.get_file_hash("/p", 1, 1).await.is_none());
    assert!(m.save().await.is_ok());
}

#[tokio::test]
async fn clear_removes_every_row() {
    let m = manager().await;

    let rows: Vec<Row2Write<String>> = (0..50)
        .map(|i| Row2Write {
            id: format!("k{i}"),
            alias: None,
            data: Some("x".repeat(500)),
            ttl_ms: TTL_METADATA_MS,
        })
        .collect();
    m.put_entries(K, rows).await;
    m.put_file_hashes(vec![(
        "/p".to_string(),
        FileHashEntry { size: 1, mtime_ms: 1, sha1: "h".to_string() },
    )])
    .await;

    let stats = m.clear().await.unwrap();
    assert_eq!(stats.rows_deleted, 51, "file hashes go too — clear means clear");

    let keys: Vec<String> = (0..50).map(|i| format!("k{i}")).collect();
    assert!(m.get_entries::<String>(K, &keys).await.is_empty());
    assert!(m.get_file_hash("/p", 1, 1).await.is_none());
}

#[tokio::test]
async fn clear_without_a_pool_is_harmless() {
    let m = ContentCacheManager::new(db::new_handle()).unwrap();
    let stats = m.clear().await.unwrap();
    assert_eq!(stats.rows_deleted, 0);
}
