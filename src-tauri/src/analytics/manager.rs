use super::client::AnalyticsClient;
use super::config::AnalyticsConfig;
use super::event::{AnalyticsEvent, EventBuilder};
use super::storage::AnalyticsStorage;
use log::{debug, error, info, warn};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub struct AnalyticsManager {
    config: Arc<Mutex<AnalyticsConfig>>,

    storage: Arc<AnalyticsStorage>,

    event_sender: mpsc::UnboundedSender<AnalyticsEvent>,

    session_id: String,

    user_id: Option<String>,
}

impl AnalyticsManager {
    pub fn new(config: AnalyticsConfig, storage_dir: std::path::PathBuf) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let session_id = Uuid::new_v4().to_string();

        let user_id = Self::generate_anonymous_user_id();

        info!(
            "AnalyticsManager initialized - Session: {}, Analytics Enabled: {}",
            session_id, config.enabled
        );

        let storage = Arc::new(AnalyticsStorage::new(storage_dir.clone()));
        
        // Initialize storage async
        let storage_clone = storage.clone();
        tokio::spawn(async move {
            if let Err(e) = storage_clone.init().await {
                error!("Failed to initialize analytics storage: {}", e);
            }
        });

        let config_arc = Arc::new(Mutex::new(config.clone()));
        tokio::spawn(Self::event_processor(rx, config_arc.clone(), storage.clone()));

        Self {
            config: config_arc,
            storage,
            event_sender: tx,
            session_id,
            user_id,
        }
    }

    fn generate_anonymous_user_id() -> Option<String> {
        match machineid_rs::IdBuilder::new(machineid_rs::Encryption::SHA256)
            .add_component(machineid_rs::HWIDComponent::SystemID)
            .build("norisk_launcher")
        {
            Ok(id) => {
                let mut hasher = Sha256::new();
                hasher.update(id.as_bytes());
                let result = hasher.finalize();
                let user_id = format!("{:x}", result);

                debug!("Generated anonymous user_id: {}...", &user_id[..16]);
                Some(user_id)
            }
            Err(e) => {
                warn!("Failed to generate user_id: {}. Analytics will work without user tracking.", e);
                None
            }
        }
    }

    pub fn track(&self, name: impl Into<String>) {
        let event_name = name.into();
        info!("[Analytics] Tracking event: {}", event_name);
        
        let event = AnalyticsEvent {
            name: event_name,
            timestamp: chrono::Utc::now(),
            properties: HashMap::new(),
            session_id: Some(self.session_id.clone()),
            user_id: self.user_id.clone(),
        };

        self.send_event(event);
    }

    pub fn track_with_props(
        &self,
        name: impl Into<String>,
        properties: HashMap<String, serde_json::Value>,
    ) {
        let event = AnalyticsEvent {
            name: name.into(),
            timestamp: chrono::Utc::now(),
            properties,
            session_id: Some(self.session_id.clone()),
            user_id: self.user_id.clone(),
        };

        self.send_event(event);
    }

    pub fn event(&self, name: impl Into<String>) -> EventBuilderWrapper<'_> {
        EventBuilderWrapper {
            builder: EventBuilder::new(name),
            manager: self,
        }
    }

    fn send_event(&self, event: AnalyticsEvent) {
        info!("[Analytics] Queueing event '{}' to background processor", event.name);
        if let Err(e) = self.event_sender.send(event.clone()) {
            error!("[Analytics] Failed to queue event: {}", e);
        } else {
            info!("[Analytics] Event '{}' successfully queued", event.name);
        }
    }

    pub async fn update_config(&self, new_config: AnalyticsConfig) {
        if let Err(e) = new_config.validate() {
            error!("Invalid analytics config: {}", e);
            return;
        }

        *self.config.lock().await = new_config.clone();
        info!("Analytics configuration updated - Enabled: {}", new_config.enabled);
    }

    pub async fn disable(&self) {
        let mut config = self.config.lock().await;
        config.enabled = false;
        info!("Analytics disabled by user");
    }

    pub async fn enable(&self) {
        let mut config = self.config.lock().await;
        config.enabled = true;
        info!("Analytics enabled by user");
    }

    pub async fn is_enabled(&self) -> bool {
        self.config.lock().await.enabled
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn get_storage(&self) -> Arc<AnalyticsStorage> {
        self.storage.clone()
    }

    async fn event_processor(
        mut rx: mpsc::UnboundedReceiver<AnalyticsEvent>,
        config: Arc<Mutex<AnalyticsConfig>>,
        storage: Arc<AnalyticsStorage>,
    ) {
        let mut event_batch: Vec<AnalyticsEvent> = Vec::new();

        let initial_config = config.lock().await;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            initial_config.batch_interval_secs,
        ));
        drop(initial_config);

        info!("[Analytics] Event processor started");

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    info!("[Analytics] Processor received event: {}", event.name);
                    event_batch.push(event);
                    info!("[Analytics] Current batch size: {}", event_batch.len());

                    let config_guard = config.lock().await;
                    let batch_size = config_guard.batch_size;
                    let is_enabled = config_guard.enabled;
                    drop(config_guard);
                    
                    info!("[Analytics] Batch limit: {}, Enabled: {}", batch_size, is_enabled);
                    
                    if event_batch.len() >= batch_size {
                        info!("[Analytics] Batch full! Flushing {} events", event_batch.len());
                        Self::flush_batch(&mut event_batch, &config, &storage).await;
                    } else {
                        info!("[Analytics] Batch not full ({}/{})", event_batch.len(), batch_size);
                    }
                }

                _ = interval.tick() => {
                    if !event_batch.is_empty() {
                        info!("[Analytics] Periodic flush triggered ({} events)", event_batch.len());
                        Self::flush_batch(&mut event_batch, &config, &storage).await;
                    }
                }
            }
        }
    }

    async fn flush_batch(
        batch: &mut Vec<AnalyticsEvent>,
        config: &Arc<Mutex<AnalyticsConfig>>,
        storage: &Arc<AnalyticsStorage>,
    ) {
        if batch.is_empty() {
            return;
        }

        info!("[Analytics] flush_batch called with {} events", batch.len());
        
        let config_guard = config.lock().await;

        if !config_guard.enabled {
            warn!("[Analytics] DISABLED! Dropping {} events", batch.len());
            batch.clear();
            return;
        }

        info!("[Analytics] Saving {} events to local storage", batch.len());
        let events = batch.clone();
        let storage_clone = storage.clone();
        
        // Always store locally first
        if let Err(e) = storage_clone.store_events(events.clone()).await {
            error!("[Analytics] Failed to store events locally: {}", e);
        }

        info!("[Analytics] Sending {} events to: {}", batch.len(), config_guard.endpoint_url);
        let client_config = config_guard.clone();
        drop(config_guard);

        // Then send to HTTP endpoint (non-blocking)
        tokio::spawn(async move {
            info!("[Analytics] HTTP task spawned for {} events", events.len());
            let client = AnalyticsClient::new(client_config);

            match client.send_batch(events).await {
                Ok(_) => {
                    info!("[Analytics] HTTP request successful!");
                }
                Err(e) => {
                    error!("[Analytics] HTTP request failed: {}", e);
                }
            }
        });

        batch.clear();
        info!("[Analytics] Batch cleared");
    }
}

pub struct EventBuilderWrapper<'a> {
    builder: EventBuilder,
    manager: &'a AnalyticsManager,
}

impl<'a> EventBuilderWrapper<'a> {
    pub fn property(mut self, key: impl Into<String>, value: impl serde::Serialize) -> Self {
        self.builder = self.builder.property(key, value);
        self
    }

    pub fn properties(mut self, props: HashMap<String, serde_json::Value>) -> Self {
        self.builder = self.builder.properties(props);
        self
    }

    pub fn send(self) {
        let event = self.builder.build(
            Some(self.manager.session_id.clone()),
            self.manager.user_id.clone(),
        );
        self.manager.send_event(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_manager_creation() {
        let config = AnalyticsConfig::default();
        let manager = AnalyticsManager::new(config);

        assert!(!manager.session_id().is_empty());
    }

    #[tokio::test]
    async fn test_track_event() {
        let config = AnalyticsConfig {
            enabled: false,
            ..Default::default()
        };
        let manager = AnalyticsManager::new(config);

        manager.track("test_event");
        manager.track_with_props("test_event2", HashMap::new());
    }

    #[tokio::test]
    async fn test_enable_disable() {
        let config = AnalyticsConfig::default();
        let manager = AnalyticsManager::new(config);

        manager.enable().await;
        assert!(manager.is_enabled().await);

        manager.disable().await;
        assert!(!manager.is_enabled().await);
    }
}

