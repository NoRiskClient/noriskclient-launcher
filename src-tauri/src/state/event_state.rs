use crate::error::Result;
use crate::state::process_state::ProcessMetadata;
use dashmap::DashMap;
use log::info;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    InstallingJava,
    DownloadingLibraries,
    ExtractingNatives,
    DownloadingAssets,
    ReusingMinecraftAssets,
    CopyingInitialData,
    CopyingNoRiskClientAssets,
    DownloadingNoRiskClientAssets,
    DownloadingClient,
    InstallingFabric,
    InstallingQuilt,
    InstallingForge,
    InstallingNeoForge,
    PatchingForge,
    DownloadingMods,
    SyncingMods,
    LaunchingMinecraft,
    MinecraftOutput,
    AccountLogin,
    AccountLoginStarted,
    AccountLoginWaitingForBrowser,
    AccountLoginExchangingToken,
    AccountLoginExchangingXboxToken,
    AccountLoginExchangingXstsToken,
    AccountLoginGettingMinecraftToken,
    AccountLoginCheckingEntitlements,
    AccountLoginFetchingProfile,
    AccountLoginCompleted,
    AccountRefresh,
    AccountLogout,
    ProfileUpdate,
    TriggerProfileUpdate,
    MinecraftProcessExited,
    MinecraftSkinChanged,
    Error,
    OfflineMode,
    LaunchSuccessful,
    CrashReportContentAvailable,
    MigrationStarted,
    MigrationCompleted,
    MigrationFailed,
    ExportingProfile,
    ProcessMetricsUpdate,
    TaskProgress,
}

#[derive(Serialize, Clone)]
pub struct EventPayload {
    pub event_id: Uuid,
    pub event_type: EventType,
    pub target_id: Option<Uuid>,
    pub message: String,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MinecraftProcessExitedPayload {
    pub profile_id: Uuid,
    pub process_id: Uuid,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub process_metadata: Option<ProcessMetadata>,
    pub crash_report_content: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CrashReportContentAvailablePayload {
    pub process_id: Uuid,
    pub content: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProcessMetricsPayload {
    pub process_id: Uuid,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
struct EventInfo {
    event_type: EventType,
    target_id: Option<Uuid>,
    start_time: std::time::SystemTime,
}

#[derive(Clone)]
pub struct EventState {
    app: Option<Arc<tauri::AppHandle>>,
    active_events: DashMap<Uuid, EventInfo>,
}

impl EventState {
    pub fn new(app: Option<Arc<tauri::AppHandle>>) -> Self {
        info!("Initializing EventState...");
        let state = Self {
            app,
            active_events: DashMap::new(),
        };
        info!("Successfully initialized EventState.");
        state
    }

    pub async fn emit(&self, payload: EventPayload) -> Result<()> {
        // Track the event if it's a new one
        if !self.active_events.contains_key(&payload.event_id) {
            self.active_events.insert(
                payload.event_id,
                EventInfo {
                    event_type: payload.event_type.clone(),
                    target_id: payload.target_id,
                    start_time: std::time::SystemTime::now(),
                },
            );
        }

        // Emit the event to the frontend
        if let Some(app) = &self.app {
            app.emit("state_event", payload)
                .map_err(|e| crate::error::AppError::TauriError(e))?;
        }

        Ok(())
    }

    /// Specific helper to emit a TriggerProfileUpdate event.
    pub async fn trigger_profile_update(&self, profile_id: Uuid) -> Result<()> {
        let payload = EventPayload {
            event_id: Uuid::new_v4(), // Generate a new ID for this trigger event
            event_type: EventType::TriggerProfileUpdate,
            target_id: Some(profile_id),
            message: format!("Profile {} data updated, UI refresh triggered.", profile_id),
            progress: None,
            error: None,
        };
        self.emit(payload).await // Use the existing emit method
    }

    pub async fn skin_changed(&self, account_id: Option<Uuid>) -> Result<()> {
        let payload = EventPayload {
            event_id: Uuid::new_v4(),
            event_type: EventType::MinecraftSkinChanged,
            target_id: account_id,
            message: "Active account skin changed, UI refresh triggered.".to_string(),
            progress: None,
            error: None,
        };
        self.emit(payload).await
    }

    pub async fn complete_event(&self, event_id: Uuid) -> Result<()> {
        self.active_events.remove(&event_id);
        Ok(())
    }

    pub fn get_active_events(&self) -> Vec<(Uuid, EventInfo)> {
        self.active_events
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().clone()))
            .collect()
    }
}

pub struct ProgressThrottle {
    last_ms: AtomicU64,
    interval_ms: u64,
}

impl ProgressThrottle {
    pub fn new(interval_ms: u64) -> Self {
        Self {
            last_ms: AtomicU64::new(0),
            interval_ms,
        }
    }

    pub fn should_emit(&self) -> bool {
        self.should_emit_at(now_ms())
    }

    pub fn should_emit_at(&self, now_ms: u64) -> bool {
        let last = self.last_ms.load(Ordering::Relaxed);
        if now_ms.saturating_sub(last) < self.interval_ms {
            return false;
        }
        self.last_ms
            .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "event_state_test.rs"]
mod tests;
