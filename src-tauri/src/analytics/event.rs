use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsEvent {
    pub name: String,

    #[serde(with = "chrono::serde::ts_seconds")]
    pub timestamp: DateTime<Utc>,

    #[serde(default)]
    pub properties: HashMap<String, serde_json::Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
}

impl AnalyticsEvent {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            timestamp: Utc::now(),
            properties: HashMap::new(),
            session_id: None,
            user_id: None,
        }
    }

    pub fn with_property(
        mut self,
        key: impl Into<String>,
        value: impl Serialize,
    ) -> Self {
        if let Ok(json_value) = serde_json::to_value(value) {
            self.properties.insert(key.into(), json_value);
        }
        self
    }

    pub fn with_session(mut self, session_id: String) -> Self {
        self.session_id = Some(session_id);
        self
    }

    pub fn with_user(mut self, user_id: String) -> Self {
        self.user_id = Some(user_id);
        self
    }
}

pub struct EventBuilder {
    name: String,
    properties: HashMap<String, serde_json::Value>,
}

impl EventBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            properties: HashMap::new(),
        }
    }

    pub fn property(mut self, key: impl Into<String>, value: impl Serialize) -> Self {
        if let Ok(json_value) = serde_json::to_value(value) {
            self.properties.insert(key.into(), json_value);
        }
        self
    }

    pub fn properties(mut self, props: HashMap<String, serde_json::Value>) -> Self {
        self.properties.extend(props);
        self
    }

    pub fn build(self, session_id: Option<String>, user_id: Option<String>) -> AnalyticsEvent {
        AnalyticsEvent {
            name: self.name,
            timestamp: Utc::now(),
            properties: self.properties,
            session_id,
            user_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_creation() {
        let event = AnalyticsEvent::new("test_event")
            .with_property("key", "value")
            .with_session("session123".to_string());

        assert_eq!(event.name, "test_event");
        assert_eq!(event.session_id, Some("session123".to_string()));
        assert!(event.properties.contains_key("key"));
    }

    #[test]
    fn test_event_builder() {
        let event = EventBuilder::new("profile_launched")
            .property("version", "1.21.4")
            .property("count", 42)
            .build(Some("sess".to_string()), None);

        assert_eq!(event.name, "profile_launched");
        assert_eq!(event.properties.len(), 2);
    }
}

