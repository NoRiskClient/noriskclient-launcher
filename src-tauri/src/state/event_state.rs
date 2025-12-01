use crate::error::Result;
use crate::state::process_state::ProcessMetadata;
use dashmap::DashMap;
use log::info;
use serde::{Deserialize, Serialize};
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
    AccountRefresh,
    AccountLogout,
    ProfileUpdate,
    TriggerProfileUpdate,
    MinecraftProcessExited,
    StarlightSkinUpdated,
    Error,
    LaunchSuccessful,
    CrashReportContentAvailable,
    MigrationStarted,
    MigrationCompleted,
    MigrationFailed,
    ExportingProfile,
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
