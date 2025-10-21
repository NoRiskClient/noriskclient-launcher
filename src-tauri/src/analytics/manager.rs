use super::client::AnalyticsClient;
use super::config::AnalyticsConfig;
use super::event::{AnalyticsEvent, EventBuilder};
use log::{debug, error, info, warn};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub struct AnalyticsManager {
    config: Arc<Mutex<AnalyticsConfig>>,

    event_sender: mpsc::UnboundedSender<AnalyticsEvent>,

    session_id: String,

    user_id: Option<String>,
}

impl AnalyticsManager {
    pub fn new(config: AnalyticsConfig) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let session_id = Uuid::new_v4().to_string();

        let user_id = Self::generate_anonymous_user_id();

        info!(
            "AnalyticsManager initialized - Session: {}, Analytics Enabled: {}",
            session_id, config.enabled
        );

        let config_arc = Arc::new(Mutex::new(config.clone()));
        tokio::spawn(Self::event_processor(rx, config_arc.clone()));

        Self {
            config: config_arc,
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
        let event = AnalyticsEvent {
            name: name.into(),
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
        if let Err(e) = self.event_sender.send(event) {
            error!("Failed to queue analytics event: {}", e);
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

    async fn event_processor(
        mut rx: mpsc::UnboundedReceiver<AnalyticsEvent>,
        config: Arc<Mutex<AnalyticsConfig>>,
    ) {
        let mut event_batch: Vec<AnalyticsEvent> = Vec::new();

        let initial_config = config.lock().await;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            initial_config.batch_interval_secs,
        ));
        drop(initial_config);

        debug!("Analytics event processor started");

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    debug!("Received analytics event: {}", event.name);
                    event_batch.push(event);

                    let config_guard = config.lock().await;
                    if event_batch.len() >= config_guard.batch_size {
                        drop(config_guard);
                        Self::flush_batch(&mut event_batch, &config).await;
                    }
                }

                _ = interval.tick() => {
                    if !event_batch.is_empty() {
                        debug!("Periodic flush triggered ({} events)", event_batch.len());
                        Self::flush_batch(&mut event_batch, &config).await;
                    }
                }
            }
        }
    }

    async fn flush_batch(batch: &mut Vec<AnalyticsEvent>, config: &Arc<Mutex<AnalyticsConfig>>) {
        if batch.is_empty() {
            return;
        }

        let config_guard = config.lock().await;

        if !config_guard.enabled {
            debug!(
                "Analytics is disabled, dropping {} events",
                batch.len()
            );
            batch.clear();
            return;
        }

        info!("Flushing {} analytics events to backend", batch.len());

        let events = batch.clone();
        let client_config = config_guard.clone();
        drop(config_guard);

        tokio::spawn(async move {
            let client = AnalyticsClient::new(client_config);

            match client.send_batch(events).await {
                Ok(_) => {
                    debug!("Successfully sent analytics batch");
                }
                Err(e) => {
                    error!("Failed to send analytics batch: {}", e);
                }
            }
        });

        batch.clear();
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

