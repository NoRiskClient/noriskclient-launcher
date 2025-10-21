use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsConfig {
    pub enabled: bool,

    pub endpoint_url: String,

    pub headers: HashMap<String, String>,

    pub payload_format: PayloadFormat,

    pub batch_size: usize,

    pub batch_interval_secs: u64,

    pub enable_retry: bool,

    pub max_retries: u32,

    pub request_timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PayloadFormat {
    SingleEvent,

    BatchArray,

    CustomWrapper {
        events_key: String,
        wrapper_fields: HashMap<String, serde_json::Value>,
    },
}

impl Default for AnalyticsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint_url: String::new(),
            headers: HashMap::new(),
            payload_format: PayloadFormat::BatchArray,
            batch_size: 50,
            batch_interval_secs: 30,
            enable_retry: true,
            max_retries: 3,
            request_timeout_secs: 10,
        }
    }
}

impl AnalyticsConfig {
    pub fn with_endpoint(endpoint_url: impl Into<String>) -> Self {
        Self {
            enabled: true,
            endpoint_url: endpoint_url.into(),
            ..Default::default()
        }
    }

    pub fn with_header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.insert(key.into(), value.into());
        self
    }

    pub fn with_payload_format(mut self, format: PayloadFormat) -> Self {
        self.payload_format = format;
        self
    }

    pub fn with_batch_config(mut self, size: usize, interval_secs: u64) -> Self {
        self.batch_size = size;
        self.batch_interval_secs = interval_secs;
        self
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.enabled && self.endpoint_url.is_empty() {
            return Err("Endpoint URL is required when analytics is enabled".to_string());
        }

        if self.batch_size == 0 {
            return Err("Batch size must be greater than 0".to_string());
        }

        if self.batch_interval_secs == 0 {
            return Err("Batch interval must be greater than 0".to_string());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_builder() {
        let config = AnalyticsConfig::with_endpoint("https://api.example.com/track")
            .with_header("X-API-Key", "secret")
            .with_batch_config(100, 60);

        assert_eq!(config.endpoint_url, "https://api.example.com/track");
        assert!(config.headers.contains_key("X-API-Key"));
        assert_eq!(config.batch_size, 100);
        assert_eq!(config.batch_interval_secs, 60);
    }

    #[test]
    fn test_config_validation() {
        let invalid_config = AnalyticsConfig {
            enabled: true,
            endpoint_url: String::new(),
            ..Default::default()
        };

        assert!(invalid_config.validate().is_err());

        let valid_config = AnalyticsConfig::with_endpoint("https://api.example.com");
        assert!(valid_config.validate().is_ok());
    }
}

