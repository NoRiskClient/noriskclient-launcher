use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use log::{debug, warn};
use std::collections::HashMap;
use tauri::command;
use crate::state::state_manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsEvent {
    #[serde(rename = "event_type")]
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "session_id")]
    pub session_id: String,
    #[serde(rename = "user_id")]
    pub user_id: String,
    pub properties: Option<HashMap<String, Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackEventRequest {
    pub events: Vec<AnalyticsEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackEventResponse {
    pub success: bool,
    pub message: Option<String>,
}

const ANALYTICS_URL: &str = "https://analytics-api-staging.norisk.gg/api/track";

/// Fire-and-forget analytics from Rust call sites.
/// Spawns the HTTP request — returns immediately so callers never block on telemetry.
pub fn track_event(event_type: impl Into<String>, properties: HashMap<String, Value>) {
    let event_type = event_type.into();
    tokio::spawn(async move {
        let event = AnalyticsEvent {
            event_type: event_type.clone(),
            timestamp: Utc::now(),
            // Backend-originated events have no session/user context.
            session_id: String::new(),
            user_id: String::new(),
            properties: Some(properties),
        };
        if let Err(e) = send_event(event).await {
            warn!("[Analytics] {} failed: {}", event_type, e);
        }
    });
}

async fn send_event(event: AnalyticsEvent) -> Result<(), String> {
    match state_manager::State::get().await {
        Ok(state) => {
            if !state.config_manager.get_config().await.enable_analytics {
                debug!("[Analytics] Disabled - skipping {}", event.event_type);
                return Ok(());
            }
        }
        Err(e) => {
            debug!("[Analytics] State unavailable - skipping {}: {}", event.event_type, e);
            return Ok(());
        }
    }

    let request_body = TrackEventRequest { events: vec![event] };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let response = client
        .post(ANALYTICS_URL)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("send: {}", e))?;

    let status = response.status();
    if status.is_success() {
        debug!("[Analytics] Tracked (status {})", status);
        Ok(())
    } else {
        Err(format!("status {}", status))
    }
}

#[derive(Debug, Serialize)]
pub struct SystemOsInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
}

#[command]
pub fn get_system_os_info() -> SystemOsInfo {
    let os = match std::env::consts::OS {
        "macos" => "macos".to_string(),
        "windows" => "windows".to_string(),
        "linux" => "linux".to_string(),
        other => other.to_string(),
    };
    let os_version = sysinfo::System::os_version().unwrap_or_else(|| "unknown".to_string());
    let arch = std::env::consts::ARCH.to_string();
    SystemOsInfo { os, os_version, arch }
}

#[command]
pub async fn track_analytics_event(event: AnalyticsEvent) -> Result<TrackEventResponse, String> {
    debug!(
        "[Analytics] Frontend event: type={} session={} user={}",
        event.event_type, event.session_id, event.user_id
    );
    let event_type = event.event_type.clone();
    // Spawn so the frontend invoke returns immediately (no UI block on slow analytics server).
    tokio::spawn(async move {
        if let Err(e) = send_event(event).await {
            warn!("[Analytics] {} failed: {}", event_type, e);
        }
    });
    Ok(TrackEventResponse {
        success: true,
        message: None,
    })
}
