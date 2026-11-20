use crate::error::Result;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::state_manager::State;
use crate::utils::http_client::nrc_get;
use once_cell::sync::{Lazy, OnceCell};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const FRESH_FOR: Duration = Duration::from_secs(5 * 60);
pub const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30);
pub const UPDATED_EVENT: &str = "feature_flags_updated";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FlagState {
    pub enabled: bool,
    #[serde(default)]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FeatureFlags {
    #[serde(default)]
    pub flags: HashMap<String, FlagState>,
}

impl FeatureFlags {
    #[cfg(feature = "test-api")]
    pub fn is_on(&self, key: &str) -> bool {
        self.flags.get(key).is_some_and(|flag| flag.enabled)
    }

    pub fn value(&self, key: &str) -> Option<&Value> {
        self.flags
            .get(key)
            .filter(|flag| flag.enabled)
            .and_then(|flag| flag.value.as_ref())
            .filter(|value| !value.is_null())
    }

    pub fn value_as<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        serde_json::from_value(self.value(key)?.clone()).ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagSource {
    pub url: String,
    pub uuid: Option<Uuid>,
}

impl FlagSource {
    pub fn new(is_experimental: bool, uuid: Option<Uuid>) -> Self {
        Self {
            url: format!("{}/payback/flags", NoRiskApi::get_api_base(is_experimental)),
            uuid,
        }
    }
}

struct Attempt {
    source: FlagSource,
    retry_at: Instant,
}

#[derive(Default)]
pub struct FlagStore {
    snapshot: RwLock<Arc<FeatureFlags>>,
    last_attempt: tokio::sync::Mutex<Option<Attempt>>,
}

impl FlagStore {
    pub fn snapshot(&self) -> Arc<FeatureFlags> {
        self.snapshot
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub async fn current(&self, source: &FlagSource) -> (Arc<FeatureFlags>, bool) {
        self.load(source, false).await
    }

    #[cfg(feature = "test-api")]
    pub async fn refresh(&self, source: &FlagSource) -> (Arc<FeatureFlags>, bool) {
        self.load(source, true).await
    }

    async fn load(&self, source: &FlagSource, force: bool) -> (Arc<FeatureFlags>, bool) {
        let mut last_attempt = self.last_attempt.lock().await;
        let now = Instant::now();
        let fresh = last_attempt
            .as_ref()
            .is_some_and(|attempt| attempt.source == *source && now < attempt.retry_at);
        if fresh && !force {
            return (self.snapshot(), false);
        }
        let (retry_in, changed) = match fetch(source).await {
            Ok(flags) => (FRESH_FOR, self.replace(flags)),
            Err(error) => {
                log::warn!("[FeatureFlags] Refresh failed, keeping last flags: {}", error);
                (RETRY_AFTER_FAILURE, false)
            }
        };
        *last_attempt = Some(Attempt {
            source: source.clone(),
            retry_at: now + retry_in,
        });
        (self.snapshot(), changed)
    }

    fn replace(&self, flags: FeatureFlags) -> bool {
        let mut snapshot = self
            .snapshot
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if **snapshot == flags {
            return false;
        }
        *snapshot = Arc::new(flags);
        true
    }
}

async fn fetch(source: &FlagSource) -> Result<FeatureFlags> {
    let mut request = nrc_get(&source.url).log_as("feature flags");
    if let Some(uuid) = source.uuid {
        request = request.query(&[("uuid", uuid)]);
    }
    request.json("feature flags").await
}

static STORE: Lazy<FlagStore> = Lazy::new(FlagStore::default);
static APP: OnceCell<AppHandle> = OnceCell::new();

async fn active_source() -> Option<FlagSource> {
    let state = State::get().await.ok()?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    let uuid = state
        .minecraft_account_manager_v2
        .get_all_accounts()
        .await
        .ok()?
        .into_iter()
        .find(|account| account.active)
        .map(|account| account.id);
    Some(FlagSource::new(is_experimental, uuid))
}

pub async fn current() -> Arc<FeatureFlags> {
    let Some(source) = active_source().await else {
        return STORE.snapshot();
    };
    let (flags, changed) = STORE.current(&source).await;
    if changed {
        if let Some(app) = APP.get() {
            let _ = app.emit(UPDATED_EVENT, flags.as_ref());
        }
    }
    flags
}

pub fn check_in_background() {
    if APP.get().is_some() {
        tauri::async_runtime::spawn(current());
    }
}

pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async {
        let mut ticker = tokio::time::interval(RETRY_AFTER_FAILURE);
        loop {
            ticker.tick().await;
            current().await;
        }
    });
}
