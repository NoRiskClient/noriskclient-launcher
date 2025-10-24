use super::config::{AnalyticsConfig, PayloadFormat};
use super::event::AnalyticsEvent;
use log::{debug, error, info, warn};
use reqwest::Client;
use serde_json::json;
use std::time::Duration;

pub struct AnalyticsClient {
    config: AnalyticsConfig,
    http_client: Client,
}

impl AnalyticsClient {
    pub fn new(config: AnalyticsConfig) -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(config.request_timeout_secs))
            .build()
            .unwrap_or_else(|e| {
                error!("Failed to create HTTP client: {}. Using default.", e);
                Client::new()
            });

        Self {
            config,
            http_client,
        }
    }

    pub async fn send_batch(&self, events: Vec<AnalyticsEvent>) -> Result<(), String> {
        if events.is_empty() {
            debug!("[Analytics Client] No events to send");
            return Ok(());
        }

        info!("[Analytics Client] Preparing {} events for {}", events.len(), self.config.endpoint_url);

        let payload = self.format_payload(&events)?;

        if self.config.enable_retry {
            self.send_with_retry(payload).await
        } else {
            self.send_request(payload).await
        }
    }

    fn format_payload(&self, events: &[AnalyticsEvent]) -> Result<serde_json::Value, String> {
        match &self.config.payload_format {
            PayloadFormat::SingleEvent => {
                if events.len() > 1 {
                    warn!(
                        "SingleEvent format configured but {} events in batch. Sending only first.",
                        events.len()
                    );
                }
                serde_json::to_value(&events[0])
                    .map_err(|e| format!("Failed to serialize event: {}", e))
            }

            PayloadFormat::BatchArray => {
                let payload = json!({
                    "events": events
                });
                Ok(payload)
            }

            PayloadFormat::CustomWrapper {
                events_key,
                wrapper_fields,
            } => {
                let mut payload = serde_json::Map::new();

                if let Ok(events_value) = serde_json::to_value(events) {
                    payload.insert(events_key.clone(), events_value);
                }

                for (key, value) in wrapper_fields {
                    payload.insert(key.clone(), value.clone());
                }

                Ok(serde_json::Value::Object(payload))
            }
        }
    }

    async fn send_with_retry(&self, payload: serde_json::Value) -> Result<(), String> {
        let mut attempts = 0;
        let max_attempts = self.config.max_retries + 1;

        loop {
            attempts += 1;

            match self.send_request(payload.clone()).await {
                Ok(_) => {
                    if attempts > 1 {
                        debug!("Request succeeded after {} attempts", attempts);
                    }
                    return Ok(());
                }
                Err(e) => {
                    if attempts >= max_attempts {
                        error!(
                            "Request failed after {} attempts. Giving up. Error: {}",
                            attempts, e
                        );
                        return Err(e);
                    }

                    warn!(
                        "Request failed (attempt {}/{}): {}. Retrying...",
                        attempts, max_attempts, e
                    );

                    let delay = Duration::from_secs(2u64.pow(attempts - 1));
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    async fn send_request(&self, payload: serde_json::Value) -> Result<(), String> {
        info!("[Analytics Client] POST {}", self.config.endpoint_url);
        info!("[Analytics Client] Payload:\n{}", serde_json::to_string_pretty(&payload).unwrap_or_default());

        let mut request = self
            .http_client
            .post(&self.config.endpoint_url)
            .json(&payload);

        info!("[Analytics Client] Adding {} headers", self.config.headers.len());
        for (key, value) in &self.config.headers {
            request = request.header(key, value);
        }

        info!("[Analytics Client] Sending request...");
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                info!("[Analytics Client] Response status: {}", status);

                if status.is_success() {
                    info!("[Analytics Client] SUCCESS!");
                    Ok(())
                } else {
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<unable to read body>".to_string());

                    error!(
                        "[Analytics Client] FAILED status {}: {}",
                        status, error_body
                    );

                    Err(format!(
                        "Analytics request returned status {}: {}",
                        status, error_body
                    ))
                }
            }
            Err(e) => {
                error!("[Analytics Client] Network error: {}", e);
                Err(format!("Network error: {}", e))
            }
        }
    }

    pub fn update_config(&mut self, config: AnalyticsConfig) {
        debug!("Updating analytics client configuration");
        self.config = config.clone();

        self.http_client = Client::builder()
            .timeout(Duration::from_secs(config.request_timeout_secs))
            .build()
            .unwrap_or_else(|_| Client::new());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_payload_batch() {
        let config = AnalyticsConfig {
            payload_format: PayloadFormat::BatchArray,
            ..Default::default()
        };

        let client = AnalyticsClient::new(config);
        let events = vec![
            AnalyticsEvent::new("test1"),
            AnalyticsEvent::new("test2"),
        ];

        let payload = client.format_payload(&events).unwrap();
        assert!(payload.get("events").is_some());
    }

    #[test]
    fn test_format_payload_custom_wrapper() {
        let mut wrapper_fields = std::collections::HashMap::new();
        wrapper_fields.insert("version".to_string(), json!("1.0"));

        let config = AnalyticsConfig {
            payload_format: PayloadFormat::CustomWrapper {
                events_key: "data".to_string(),
                wrapper_fields,
            },
            ..Default::default()
        };

        let client = AnalyticsClient::new(config);
        let events = vec![AnalyticsEvent::new("test")];

        let payload = client.format_payload(&events).unwrap();
        assert!(payload.get("data").is_some());
        assert_eq!(payload.get("version").unwrap(), "1.0");
    }
}

