use crate::error::Result;
#[cfg(desktop)]
use crate::state::process_state::ProcessMetadata;
use log::info;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::broadcast;
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
    SyncingPacks,
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

#[cfg(desktop)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct MinecraftProcessExitedPayload {
    pub profile_id: Uuid,
    pub process_id: Uuid,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub was_intentionally_stopped: bool,
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

#[cfg(desktop)]
static PROCESS_EXITS: Lazy<broadcast::Sender<MinecraftProcessExitedPayload>> =
    Lazy::new(|| broadcast::channel(16).0);

#[cfg(desktop)]
pub fn subscribe_process_exits() -> broadcast::Receiver<MinecraftProcessExitedPayload> {
    PROCESS_EXITS.subscribe()
}

#[cfg(desktop)]
pub fn publish_process_exit(payload: &MinecraftProcessExitedPayload) {
    let _ = PROCESS_EXITS.send(payload.clone());
}

#[derive(Clone)]
pub struct EventState {
    app: Option<Arc<tauri::AppHandle>>,
}

impl EventState {
    pub fn new(app: Option<Arc<tauri::AppHandle>>) -> Self {
        info!("Initializing EventState...");
        let state = Self { app };
        info!("Successfully initialized EventState.");
        state
    }

    pub async fn emit(&self, payload: EventPayload) -> Result<()> {
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
