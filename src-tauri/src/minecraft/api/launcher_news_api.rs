use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::integrations::lenient;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::utils::file_utils::write_atomic;
use crate::utils::http_client::nrc_get;
use chrono::Utc;
use log::{debug, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Mutex;

const NEWS_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_MAX_AGE_MS: i64 = 5 * 60 * 1000;
const CACHE_KEEP_MS: i64 = 24 * 60 * 60 * 1000;

static CACHE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

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

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct NewsCacheFile {
    pages: HashMap<String, CachedPage>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CachedPage {
    fetched_at: i64,
    page: LauncherNewsPage,
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

    pub async fn get_page_cached(is_experimental: bool, page: u32, limit: u32) -> Result<LauncherNewsPage> {
        if is_experimental {
            return Self::get_page(true, page, limit).await;
        }
        let _one_at_a_time = CACHE_LOCK.lock().await;
        let path = cache_path();
        let key = format!("{page}:{limit}");
        let mut cache = read_cache(&path).await;
        let now = Utc::now().timestamp_millis();

        if let Some(cached) = cache.pages.get(&key) {
            let age = now - cached.fetched_at;
            if (0..CACHE_MAX_AGE_MS).contains(&age) {
                debug!("[News] page {key} from the file ({}s old)", age / 1000);
                return Ok(cached.page.clone());
            }
        }

        match Self::get_page(false, page, limit).await {
            Ok(fresh) => {
                cache.pages.retain(|_, cached| now - cached.fetched_at < CACHE_KEEP_MS);
                cache.pages.insert(key, CachedPage { fetched_at: now, page: fresh.clone() });
                save_cache(&path, &cache).await;
                Ok(fresh)
            }
            Err(err) => match cache.pages.remove(&key) {
                Some(stale) => {
                    warn!("[News] loading page {key} failed, showing the last answer: {err}");
                    Ok(stale.page)
                }
                None => Err(err),
            },
        }
    }
}

fn cache_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("launcher_news.json")
}

async fn read_cache(path: &PathBuf) -> NewsCacheFile {
    tokio::fs::read(path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

async fn save_cache(path: &PathBuf, cache: &NewsCacheFile) {
    let bytes = match serde_json::to_vec(cache) {
        Ok(bytes) => bytes,
        Err(err) => {
            warn!("[News] could not serialise the news cache: {err}");
            return;
        }
    };
    if let Err(err) = write_atomic(path, bytes).await {
        warn!("[News] could not write {}: {err}", path.display());
    }
}
