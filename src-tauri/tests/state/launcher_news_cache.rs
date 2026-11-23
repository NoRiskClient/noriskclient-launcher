use noriskclient_launcher_v3_lib::minecraft::api::launcher_news_api::{LauncherNewsApi, LauncherNewsPage};
use noriskclient_launcher_v3_lib::state::content_cache_state::ContentCacheManager;

#[tokio::test]
async fn a_fresh_cached_page_is_served_from_the_database() {
    let cache = ContentCacheManager::new(crate::harness::temp_db_handle().await).unwrap();
    let cached: LauncherNewsPage = serde_json::from_value(serde_json::json!({
        "items": [],
        "page": 1,
        "totalPages": 7
    }))
    .unwrap();
    cache.put_entry("launcher_news", "1:12", None, Some(&cached), 60_000).await;

    let page = LauncherNewsApi::get_page_cached(&cache, false, 1, 12).await.unwrap();

    assert_eq!(page.total_pages, 7);
}
