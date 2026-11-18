use crate::error::Result;
use crate::integrations::lenient;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::content_cache_state::ContentCacheManager;
use crate::utils::http_client::nrc_get;
use log::warn;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const NEWS_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const NEWS_CACHE_KIND: &str = "launcher_news";
const NEWS_CACHE_TTL_MS: u64 = 5 * 60 * 1000;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct LocalizedText {
    pub en: String,
    pub de: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LauncherNewsItem {
    pub id: String,
    pub thumbnail_url: String,
    pub url: Option<LocalizedText>,
    pub title: LocalizedText,
    pub published_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LauncherNewsPage {
    #[serde(deserialize_with = "lenient::vec")]
    pub items: Vec<LauncherNewsItem>,
    pub page: u32,
    pub total_pages: u32,
}

pub struct LauncherNewsApi;

impl LauncherNewsApi {
    async fn get_page(is_experimental: bool, page: u32, limit: u32) -> Result<LauncherNewsPage> {
        let url = format!("{}/launcher/news", NoRiskApi::get_api_base(is_experimental));
        nrc_get(&url)
            .query(&[("page", page.to_string()), ("limit", limit.to_string())])
            .timeout(NEWS_REQUEST_TIMEOUT)
            .json::<LauncherNewsPage>("Launcher news")
            .await
    }

    pub async fn get_page_cached(
        cache: &ContentCacheManager,
        is_experimental: bool,
        page: u32,
        limit: u32,
    ) -> Result<LauncherNewsPage> {
        if is_experimental {
            return Self::get_page(true, page, limit).await;
        }
        let key = format!("{page}:{limit}");
        let cached = cache.get_entry::<LauncherNewsPage>(NEWS_CACHE_KIND, &key).await;
        if let Some(fresh) = cached.as_ref().filter(|entry| entry.is_fresh()).and_then(|entry| entry.data.clone()) {
            return Ok(fresh);
        }

        match Self::get_page(false, page, limit).await {
            Ok(fresh) => {
                cache.put_entry(NEWS_CACHE_KIND, &key, None, Some(&fresh), NEWS_CACHE_TTL_MS).await;
                Ok(fresh)
            }
            Err(err) => match cached.and_then(|entry| entry.data) {
                Some(stale) => {
                    warn!("[News] loading page {key} failed, showing the last answer: {err}");
                    Ok(stale)
                }
                None => Err(err),
            },
        }
    }
}
