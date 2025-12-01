use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::event_state::{
    EventPayload, EventState, EventType, MinecraftProcessExitedPayload,
};
use crate::state::{self, post_init::PostInitializationHandler, State};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
use tauri::Manager;
use tokio::fs::{self as async_fs, File};
use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader};
use tokio::sync::Mutex;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio::time::{interval, Duration};
use uuid::Uuid;

// NEUE Imports für notify
use notify::{
    event::CreateKind, Config as NotifyConfig, Event as NotifyEvent, EventKind as NotifyEventKind,
    RecommendedWatcher, RecursiveMode, Watcher,
};
use tokio::sync::mpsc; // Für den Channel

const PROCESSES_FILENAME: &str = "processes.json";
const NOTIFY_EVENT_CHANNEL_BUFFER: usize = 100;

pub struct ProcessManager {
    app_handle: Arc<tauri::AppHandle>,
    processes: Arc<RwLock<HashMap<Uuid, Process>>>,
    processes_file_path: PathBuf,
    save_lock: Mutex<()>,
    launching_processes: Arc<DashMap<Uuid, JoinHandle<()>>>,

    notify_event_tx: mpsc::Sender<CrashReportNotification>,
    active_watchers: Arc<RwLock<HashMap<Uuid, RecommendedWatcher>>>,
    crash_report_contents: Arc<DashMap<Uuid, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMetadata {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub start_time: DateTime<Utc>,
    pub state: ProcessState,
    pub pid: u32,
    pub account_uuid: Option<String>,
    pub account_name: Option<String>,
    pub minecraft_version: Option<String>,
    pub modloader: Option<String>,
    pub modloader_version: Option<String>,
    pub norisk_pack: Option<String>,
    pub profile_name: Option<String>,
    pub post_exit_hook: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProcessState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Crashed(String),
}

#[derive(Debug)]
struct Process {
    metadata: ProcessMetadata,
    last_log_position: Arc<Mutex<u64>>,
}

// Kapselt die Nachricht, die vom notify event handler zum ProcessManager geschickt wird
#[derive(Debug)]
struct CrashReportNotification {
    process_id: Uuid,
    file_path: PathBuf,
}

impl ProcessManager {
    pub async fn new(
        processes_file_path: PathBuf,
        app_handle: Arc<tauri::AppHandle>,
    ) -> Result<Self> {
        log::info!(
            "Initializing ProcessManager with state file: {:?}",
            processes_file_path
        );
        let processes = Arc::new(RwLock::new(HashMap::new()));
        let save_lock = Mutex::new(());
        let launching_processes = Arc::new(DashMap::new());
        let active_watchers = Arc::new(RwLock::new(HashMap::new()));
        let crash_report_contents = Arc::new(DashMap::new());

        // Create the channel. The receiver part (rx) will be handled/stored or recreated
        // appropriately when its consuming task is spawned in on_state_ready.
        let (notify_event_tx, _notify_event_rx_placeholder) =
            mpsc::channel::<CrashReportNotification>(NOTIFY_EVENT_CHANNEL_BUFFER);

        Ok(Self {
            app_handle: Arc::clone(&app_handle),
            processes,
            processes_file_path,
            save_lock,
            launching_processes,
            notify_event_tx, // Store the sender
            active_watchers,
            crash_report_contents,
            // notify_event_rx: Mutex::new(Some(notify_event_rx_placeholder)), // Example of how to store rx
        })
    }

    async fn process_crash_report_events(
        app_handle: Arc<tauri::AppHandle>,
        mut receiver: mpsc::Receiver<CrashReportNotification>,
    ) {
        log::info!("Starting crash report event processor task.");
        let global_state_res = State::get().await;

        let event_state_clone = match global_state_res {
            Ok(s) => s.event_state.clone(),
            Err(e) => {
                log::error!("Crash report event processor failed to get global state: {}. Task cannot proceed.", e);
                return;
            }
        };

        while let Some(notification) = receiver.recv().await {
            log::info!(
                "Received new crash report notification for process {}: {:?}",
                notification.process_id,
                notification.file_path
            );
            match tokio::fs::read_to_string(&notification.file_path).await {
                Ok(content) => {
                    let file_name = notification
                        .file_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy();
                    let message_to_log = format!("[CRASH REPORT - {}]:\\n{}", file_name, content);

                    // Store the crash report content
                    if let Ok(global_state) = State::get().await {
                        global_state
                            .process_manager
                            .crash_report_contents
                            .insert(notification.process_id, content.clone());
                        log::info!(
                            "Stored crash report content for process {} in ProcessManager.",
                            notification.process_id
                        );

                        // Emit new event with crash report content
                        let crash_report_available_payload =
                            crate::state::event_state::CrashReportContentAvailablePayload {
                                process_id: notification.process_id,
                                content: content.clone(), // Clone content for the new event
                            };
                        let event_payload = EventPayload {
                            event_id: Uuid::new_v4(),
                            event_type: EventType::CrashReportContentAvailable,
                            target_id: Some(notification.process_id),
                            message: serde_json::to_string(&crash_report_available_payload).unwrap_or_else(|e| {
                                log::error!("Failed to serialize CrashReportContentAvailablePayload for {}: {}", notification.process_id, e);
                                String::from("{ \"error\": \"serialization failed\" }")
                            }),
                            progress: None,
                            error: None,
                        };
                        if let Err(e) = global_state.event_state.emit(event_payload).await {
                            log::error!("Failed to emit CrashReportContentAvailable event for process {}: {}", notification.process_id, e);
                        }
                    } else {
                        log::error!("Failed to get global state to store/emit crash report content for process {}.", notification.process_id);
                    }

                    let report_event_payload = EventPayload {
                        event_id: Uuid::new_v4(),
                        event_type: EventType::MinecraftOutput,
                        target_id: Some(notification.process_id),
                        message: message_to_log,
                        progress: None,
                        error: None,
                    };
                    if let Err(e) = event_state_clone.emit(report_event_payload).await {
                        log::error!(
                            "Failed to emit crash report as MinecraftOutput for process {}: {}",
                            notification.process_id,
                            e
                        );
                    } else {
                        log::info!(
                            "Successfully emitted crash report for process {} to UI.",
                            notification.process_id
                        );
                    }
                }
                Err(e) => {
                    log::error!(
                        "Failed to read content of new crash report {:?} for process {}: {}",
                        notification.file_path,
                        notification.process_id,
                        e
                    );
                }
            }
        }
        log::info!("Crash report event processor task finished.");
    }

    // Kombinierte Funktion zum Laden von Prozessen und Starten der Watcher für bereits laufende Prozesse
    async fn load_processes_and_watchers(&self) -> Result<()> {
        let file_path = &self.processes_file_path;
        if !file_path.exists() {
            log::info!(
                "Processes file not found ('{:?}'), starting fresh.",
                file_path
            );
            return Ok(());
        }
        log::info!("Loading processes metadata from '{:?}'...", file_path);
        let json_content = async_fs::read_to_string(&file_path)
            .await
            .map_err(AppError::Io)?;

        match serde_json::from_str::<Vec<ProcessMetadata>>(&json_content) {
            Ok(loaded_metadata) => {
                log::info!(
                    "Successfully deserialized {} process metadata entries.",
                    loaded_metadata.len()
                );
                let mut sys = System::new();
                let pids_to_refresh: Vec<Pid> = loaded_metadata
                    .iter()
                    .map(|meta| Pid::from(meta.pid as usize))
                    .collect();
                sys.refresh_processes(ProcessesToUpdate::Some(&pids_to_refresh), false);

                let mut loaded_count = 0;
                let mut processes_map_writer = self.processes.write().await; // Eine Schreibsperre für die Map
                                                                             // Kein globales State-Objekt hier direkt holen, da wir im &self Kontext sind.
                                                                             // Stattdessen app_handle verwenden oder für ProfileManager den State übergeben.

                for mut metadata in loaded_metadata {
                    let process_pid = Pid::from(metadata.pid as usize);
                    if sys.process(process_pid).is_some() {
                        if metadata.state == ProcessState::Starting
                            || metadata.state == ProcessState::Stopping
                        {
                            log::warn!(
                                "Process {} (PID: {}) was in state {:?}, assuming Running on load.",
                                metadata.id,
                                metadata.pid,
                                metadata.state
                            );
                            metadata.state = ProcessState::Running;
                        }
                        log::info!(
                            "Loading running process {} (PID: {}) metadata.",
                            metadata.id,
                            metadata.pid
                        );
                        let process_entry = Process {
                            metadata: metadata.clone(), // metadata hier klonen
                            last_log_position: Arc::new(Mutex::new(0)),
                        };
                        processes_map_writer.insert(process_entry.metadata.id, process_entry);
                        log::debug!(
                            "Process {} metadata inserted into processes_map_writer.",
                            metadata.id
                        );

                        // Watcher für diesen geladenen, laufenden Prozess starten
                        log::info!(
                            "Attempting to get global state for process {} to start watcher.",
                            metadata.id
                        );
                        match State::get().await {
                            Ok(global_state) => {
                                log::info!(
                                    "Successfully got global state for process {}.",
                                    metadata.id
                                );
                                log::info!(
                                    "Attempting to get instance path for profile {} (process {}).",
                                    metadata.profile_id,
                                    metadata.id
                                );
                                match global_state
                                    .profile_manager
                                    .get_profile_instance_path(metadata.profile_id)
                                    .await
                                {
                                    Ok(instance_path) => {
                                        log::info!("Successfully got instance path {:?} for profile {} (process {}).", instance_path, metadata.profile_id, metadata.id);
                                        let crash_reports_path =
                                            instance_path.join("crash-reports");
                                        log::info!("Attempting to start crash report watcher for process {} on path {:?}.", metadata.id, crash_reports_path);
                                        if let Err(e) = self
                                            .start_crash_report_watcher(
                                                metadata.id,
                                                &crash_reports_path,
                                            )
                                            .await
                                        {
                                            log::error!("Failed to start crash report watcher for loaded process {}: {}", metadata.id, e);
                                        } else {
                                            log::info!("Successfully started or confirmed crash report watcher for process {}.", metadata.id);
                                        }
                                    }
                                    Err(e) => {
                                        log::warn!("Could not get instance path for loaded process {} to start watcher: {}", metadata.id, e);
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("Failed to get global state for process {} to start watcher: {}. Watcher not started.", metadata.id, e);
                            }
                        }
                        loaded_count += 1;
                    } else {
                        log::warn!(
                            "Ignoring stale process entry {} (PID: {}): Process not found.",
                            metadata.id,
                            metadata.pid
                        );
                    }
                }
                log::info!(
                    "Created {} active Process entries from loaded metadata.",
                    loaded_count
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to deserialize processes metadata from '{:?}': {}. Starting fresh.",
                    file_path,
                    e
                );
            }
        }
        Ok(())
    }

    async fn save_processes(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;
        log::debug!("Acquired save lock, proceeding to save processes...");

        if let Some(parent_dir) = self.processes_file_path.parent() {
            if !parent_dir.exists() {
                async_fs::create_dir_all(parent_dir)
                    .await
                    .map_err(AppError::Io)?;
                log::info!("Created directory for processes file: {:?}", parent_dir);
            }
        }

        let processes_map = self.processes.read().await;
        let metadata_list: Vec<ProcessMetadata> = processes_map
            .values()
            .map(|entry| entry.metadata.clone())
            .collect();
        drop(processes_map);

        let json_content = serde_json::to_string_pretty(&metadata_list).map_err(|e| {
            AppError::Other(format!("Failed to serialize processes metadata: {}", e))
        })?;

        async_fs::write(&self.processes_file_path, json_content)
            .await
            .map_err(AppError::Io)?;

        log::info!(
            "Successfully saved {} process metadata entries to '{:?}'.",
            metadata_list.len(),
            &self.processes_file_path
        );

        Ok(())
    }

    // NEUE Hilfsfunktion zum Starten eines Watchers für einen bestimmten Prozess und Pfad
    async fn start_crash_report_watcher(
        &self,
        process_id: Uuid,
        path_to_watch: &Path,
    ) -> Result<()> {
        if !path_to_watch.exists() {
            // Versuche das Verzeichnis zu erstellen, falls es nicht existiert (z.B. crash-reports)
            if let Err(e) = async_fs::create_dir_all(path_to_watch).await {
                log::error!(
                    "Failed to create directory {:?} for watcher: {}. Watcher not started.",
                    path_to_watch,
                    e
                );
                return Err(AppError::Io(e));
            }
            log::info!(
                "Created directory {:?} for crash report watcher.",
                path_to_watch
            );
        } else if !path_to_watch.is_dir() {
            log::error!(
                "Path {:?} is not a directory. Watcher not started for process {}.",
                path_to_watch,
                process_id
            );
            return Err(AppError::Other(format!(
                "Path {:?} is not a directory",
                path_to_watch
            )));
        }

        let tx_clone = self.notify_event_tx.clone();
        let path_buf_clone = path_to_watch.to_path_buf(); // Klonen für den Handler

        let event_handler = move |res: notify::Result<NotifyEvent>| {
            match res {
                Ok(event) => {
                    log::trace!("Received notify event: {:?}", event);
                    if matches!(event.kind, NotifyEventKind::Create(_)) {
                        // Nur auf Create-Events reagieren
                        for path in event.paths {
                            if path.is_file()
                                && path.file_name().map_or(false, |name| {
                                    name.to_string_lossy().starts_with("crash-")
                                        && name.to_string_lossy().ends_with(".txt")
                                })
                            {
                                log::info!(
                                    "Crash report file created: {:?} for process {}",
                                    path,
                                    process_id
                                );
                                let notification = CrashReportNotification {
                                    process_id,
                                    file_path: path.clone(),
                                };
                                // Sende im blockierenden Kontext, wenn nötig, oder verwende try_send
                                if let Err(e) = tx_clone.try_send(notification) {
                                    log::error!(
                                        "Failed to send crash report notification from watcher: {}",
                                        e
                                    );
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "Error in crash report watcher for process {}: {:?}",
                        process_id,
                        e
                    );
                }
            }
        };

        let mut watcher = RecommendedWatcher::new(event_handler, NotifyConfig::default())
            .map_err(|e| AppError::Other(format!("Failed to create file watcher: {}", e)))?;

        watcher
            .watch(&path_buf_clone, RecursiveMode::NonRecursive) // Nur den Ordner selbst, nicht rekursiv
            .map_err(|e| {
                AppError::Other(format!("Failed to watch path {:?}: {}", path_buf_clone, e))
            })?;

        log::info!(
            "Started crash report watcher for process {} on path {:?}",
            process_id,
            path_buf_clone
        );

        // Watcher in der Map speichern
        let mut watchers_map = self.active_watchers.write().await;
        watchers_map.insert(process_id, watcher); // Watcher wird hier verschoben

        Ok(())
    }

    // NEUE Hilfsfunktion zum Stoppen und Entfernen eines Watchers
    async fn stop_crash_report_watcher(&self, process_id: Uuid) {
        let mut watchers_map = self.active_watchers.write().await;
        if let Some(mut watcher) = watchers_map.remove(&process_id) {
            // Explizites unwatch ist bei notify v6 nicht immer nötig, wenn der Watcher gedroppt wird.
            // Aber um sicherzugehen und Pfade zu entfernen, falls der Watcher mehrere Pfade überwacht (hier nicht der Fall).
            // Da wir den Pfad nicht separat speichern, lassen wir unwatch weg und verlassen uns auf drop.
            // watcher.unwatch(path_to_unwatch).ok(); // Pfad müsste hier bekannt sein
            log::info!(
                "Stopped and removed crash report watcher for process {}",
                process_id
            );
        } else {
            log::warn!(
                "No active crash report watcher found to stop for process {}",
                process_id
            );
        }
        // Der Watcher wird gedroppt, wenn er aus der Map entfernt wird und hier aus dem Scope geht.
    }

    pub async fn start_process(
        &self,
        profile_id: Uuid,
        mut command: std::process::Command,
        account_uuid: Option<String>,
        account_name: Option<String>,
        minecraft_version: Option<String>,
        modloader: Option<String>,
        modloader_version: Option<String>,
        norisk_pack: Option<String>,
        profile_name: Option<String>,
        post_exit_hook: Option<String>,
    ) -> Result<Uuid> {
        log::info!("Attempting to start process for profile {}", profile_id);

        #[cfg(unix)]
        {
            // Potentially unnecessary if handled by dropping Child, but kept for safety
            // use std::os::unix::process::CommandExt;
            // log::debug!("Applying setsid for Unix detachment.");
            // command.setsid(); // Consider if really needed
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x00000008;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            log::debug!(
                "Applying DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP for Windows detachment."
            );
            command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        }

        let mut tokio_command = tokio::process::Command::from(command);
        let mut child = tokio_command.spawn().map_err(|e| {
            log::error!(
                "Failed to spawn process using tokio::process::Command: {}",
                e
            );
            AppError::ProcessSpawnFailed(e.to_string())
        })?;

        let pid = child.id().ok_or_else(|| {
            log::error!("Failed to get PID immediately after spawning process.");
            AppError::ProcessSpawnFailed("Could not get PID".to_string())
        })?;
        let process_id = Uuid::new_v4();

        let metadata = ProcessMetadata {
            id: process_id,
            profile_id,
            start_time: Utc::now(),
            state: ProcessState::Running,
            pid,
            account_uuid,
            account_name,
            minecraft_version,
            modloader,
            modloader_version,
            norisk_pack,
            profile_name: profile_name.clone(),
            post_exit_hook,
        };

        log::info!(
            "Process spawned successfully. ID: {}, PID: {}",
            process_id,
            pid
        );

        let process_entry = Process {
            metadata: metadata.clone(),
            last_log_position: Arc::new(Mutex::new(0)),
        };

        {
            let mut processes_map = self.processes.write().await;
            processes_map.insert(process_id, process_entry);
        }

        // Watcher für Crash-Reports starten
        // Hier brauchen wir den globalen State für den ProfileManager
        if let Ok(global_state) = State::get().await {
            match global_state
                .profile_manager
                .get_profile_instance_path(profile_id)
                .await
            {
                Ok(instance_path) => {
                    let crash_reports_path = instance_path.join("crash-reports");
                    if let Err(e) = self
                        .start_crash_report_watcher(process_id, &crash_reports_path)
                        .await
                    {
                        log::error!(
                            "Failed to start crash report watcher for new process {}: {}",
                            process_id,
                            e
                        );
                        // Prozessstart nicht unbedingt abbrechen, aber loggen.
                    }
                }
                Err(e) => {
                    log::error!(
                        "Could not get instance path for new process {} to start watcher: {}",
                        process_id,
                        e
                    );
                }
            }
        } else {
            log::error!(
                "Could not get global state to start watcher for new process {}.",
                process_id
            );
        }

        // --- BEGIN Discord State Update ---
        match State::get().await {
            Ok(state) => {
                log::debug!(
                    "Notifying Discord manager about game process {} start.",
                    process_id
                );
                state.discord_manager.notify_game_start(process_id).await;
            }
            Err(e) => {
                log::error!("Failed to get global state to update Discord timestamp for process {}: {}. Discord state might be incorrect.", process_id, e);
                // Continue execution, Discord state update is not critical for process start
            }
        }
        // --- END Discord State Update ---

        if let Err(e) = self.save_processes().await {
            log::error!(
                "Failed to save processes state immediately after starting {}: {}",
                process_id,
                e
            );
        }

        // Hide main window if configured to do so
        if let Ok(global_state) = State::get().await {
            let launcher_config = global_state.config_manager.get_config().await;
            if launcher_config.hide_on_process_start {
                log::info!("Hiding main window as configured (hide_on_process_start = true)");
                if let Some(main_window) = self.app_handle.get_webview_window("main") {
                    if let Err(e) = main_window.hide() {
                        log::error!("Failed to hide main window: {}", e);
                    } else {
                        log::info!("Successfully hid main window");
                    }
                } else {
                    log::warn!("Main window not found, could not hide it");
                }
            } else {
                log::debug!("Main window hiding disabled (hide_on_process_start = false)");
            }
        } else {
            log::error!("Could not get global state to check hide_on_process_start setting");
        }

        self.schedule_auto_open_log_window(process_id);

        let processes_arc_clone = Arc::clone(&self.processes);
        // Klon für active_watchers und den Manager selbst (oder dessen relevante Teile)
        let active_watchers_clone_for_monitor = Arc::clone(&self.active_watchers);
        // Der Monitor-Task benötigt eine Möglichkeit, stop_crash_report_watcher aufzurufen.
        // Da stop_crash_report_watcher &self benötigt und wir nicht den ganzen ProcessManager übergeben wollen,
        // wäre es besser, wenn der Monitor-Task eine Nachricht an den ProcessManager sendet oder
        // eine einfachere ID-basierte Stoppfunktion aufruft.
        // Fürs Erste: Wir müssen den Watcher entfernen, wenn der Prozess endet.
        // Der einfachste Weg ist, die process_id zu kennen und dann von außerhalb (periodic_process_check)
        // oder wenn der state.process_manager.stop_crash_report_watcher(process_id) aufgerufen wird.
        // Die stop_crash_report_watcher Funktion ist async, der Monitor-Task ist async.
        // Wir können Arc<ProcessManager> übergeben, aber das ist oft nicht ideal wegen Zyklen.
        // Alternative: Der Monitor-Task entfernt nur aus processes, und periodic_process_check räumt Watcher auf.
        // ODER: Der Monitor Task sendet eine "ProcessEnded" Nachricht, auf die der PM reagiert.

        let app_handle_clone_for_monitor = Arc::clone(&self.app_handle);

        tokio::spawn(async move {
            // State holen, um Zugriff auf den ProcessManager für das Stoppen des Watchers zu haben.
            // Das ist etwas umständlich. Besser wäre es, wenn stop_crash_report_watcher
            // keine &self Referenz auf den ProcessManager bräuchte oder der Task nur die ID meldet.
            let state_for_monitor_res = State::get().await;

            log::info!(
                "Monitor task started for process {} (PID: {})",
                process_id,
                pid
            );

            let exit_status_res = child.wait().await;

            let exit_status: Option<ExitStatus> = match exit_status_res {
                Ok(status) => {
                    log::info!(
                        "Process {} (PID: {}) exited with status: {:?}",
                        process_id,
                        pid,
                        status
                    );
                    Some(status)
                }
                Err(e) => {
                    log::error!(
                        "Failed to wait for process {} (PID: {}): {}",
                        process_id,
                        pid,
                        e
                    );
                    None
                }
            };

            let exit_code: Option<i32> = exit_status.and_then(|s| s.code());
            let mut success: bool = exit_code == Some(0);

            let was_intentionally_stopped = {
                let processes_map = processes_arc_clone.read().await;
                if let Some(process_entry) = processes_map.get(&process_id) {
                    process_entry.metadata.state == ProcessState::Stopping
                } else {
                    false
                }
            };

            if was_intentionally_stopped {
                log::info!(
                    "Process {} was intentionally stopped. Marking exit as success.",
                    process_id
                );
                success = true;
            }

            let exiting_process_metadata_clone: Option<ProcessMetadata> = {
                let processes_map_reader = processes_arc_clone.read().await;
                processes_map_reader
                    .get(&process_id)
                    .map(|p_entry| p_entry.metadata.clone())
            };

            // Try to get crash content if it was processed very fast. No extensive polling here.
            let crash_content_for_payload: Option<String> = {
                if let Ok(state) = &state_for_monitor_res {
                    state
                        .process_manager
                        .crash_report_contents
                        .remove(&process_id)
                        .map(|(_, text)| text)
                } else {
                    log::error!("Monitor task for process {} could not get state to attempt retrieving crash report.", process_id);
                    None
                }
            };

            // Event an UI senden
            if let Ok(state) = &state_for_monitor_res {
                // Re-access state for this block, or ensure it's still valid
                let specific_payload = MinecraftProcessExitedPayload {
                    profile_id,
                    process_id,
                    exit_code,
                    success,
                    process_metadata: exiting_process_metadata_clone,
                    crash_report_content: crash_content_for_payload,
                };
                let specific_payload_json = serde_json::to_string(&specific_payload)
                    .unwrap_or_else(|e| {
                        log::error!(
                            "Failed to serialize MinecraftProcessExitedPayload for {}: {}",
                            process_id,
                            e
                        );
                        format!(
                            "Failed to serialize MinecraftProcessExitedPayload for {}: {}",
                            process_id, e
                        )
                    });
                let generic_payload = EventPayload {
                    event_id: Uuid::new_v4(),
                    event_type: EventType::MinecraftProcessExited,
                    target_id: Some(process_id),
                    message: specific_payload_json,
                    progress: None,
                    error: if success {
                        None
                    } else {
                        Some(format!(
                            "Process exited with code {:?}. Intentionally stopped: {}",
                            exit_code.unwrap_or(-1),
                            was_intentionally_stopped
                        ))
                    },
                };
                if let Err(e) = state.event_state.emit(generic_payload).await {
                    log::error!(
                        "Failed to emit MinecraftProcessExited event for process {}: {}",
                        process_id,
                        e
                    );
                }
            } else {
                log::error!(
                    "Monitor task for process {} failed to get global state to emit exit event.",
                    process_id
                );
            }

            log::info!(
                "Removing process entry {} from manager post-exit.",
                process_id
            );
            let mut processes_map_writer_monitor = processes_arc_clone.write().await;
            let removed_process_metadata = processes_map_writer_monitor.remove(&process_id);
            drop(processes_map_writer_monitor);

            if removed_process_metadata.is_none() {
                log::warn!(
                    "Process entry {} was already removed before final monitor task cleanup.",
                    process_id
                );
            }

            // Watcher stoppen NACHDEM der Prozess aus der Hauptmap entfernt wurde.
            // periodic_process_check wird den Watcher sonst nicht als verwaist erkennen.
            if let Ok(state) = state_for_monitor_res {
                state
                    .process_manager
                    .stop_crash_report_watcher(process_id)
                    .await;
                if let Err(e) = state.process_manager.save_processes().await {
                    log::error!("Monitor task for process {} failed to save processes state after removal: {}. In-memory map updated, but persistence failed.", process_id, e);
                } else {
                    log::info!(
                        "Successfully saved processes state after removing {} via monitor task.",
                        process_id
                    );
                }

                // Execute post-exit hook if process was successful
                Self::execute_post_exit_hook_if_needed(
                    success,
                    &state,
                    process_id,
                    &removed_process_metadata,
                )
                .await;
            } else {
                log::error!("Monitor task for process {} could not get state to stop watcher or save processes.", process_id);
            }

            log::debug!("Monitor task finished for process {}", process_id);
        });

        Ok(process_id)
    }

    pub async fn stop_process(&self, process_id: Uuid) -> Result<()> {
        log::info!("Attempting to stop process {}", process_id);

        let mut kill_successful = false;
        let mut pid_for_error: u32 = 0;

        let mut processes_map = self.processes.write().await;

        if let Some(process) = processes_map.get_mut(&process_id) {
            pid_for_error = process.metadata.pid;
            process.metadata.state = ProcessState::Stopping;

            let pid_to_kill = process.metadata.pid;
            log::info!(
                "Attempting to kill process {} via PID {}",
                process_id,
                pid_to_kill
            );
            let mut sys = System::new();
            let pid_to_refresh = Pid::from(pid_to_kill as usize);
            sys.refresh_processes(ProcessesToUpdate::Some(&[pid_to_refresh]), false);

            if let Some(sys_process) = sys.process(pid_to_refresh) {
                if sys_process.kill() {
                    log::info!("Kill signal sent successfully to PID {}.", pid_to_kill);
                    kill_successful = true;
                } else {
                    log::error!("Failed to send kill signal to PID {}.", pid_to_kill);
                }
            } else {
                log::warn!(
                    "Process with PID {} not found by sysinfo during stop attempt. Assuming already stopped.",
                    pid_to_kill
                );
                kill_successful = true;
            }
        } else {
            drop(processes_map);
            log::warn!("Process {} not found in manager for stopping.", process_id);
            return Err(AppError::ProcessNotFound(process_id));
        }

        drop(processes_map);

        // Watcher stoppen, bevor der Prozess tatsächlich beendet wird, oder nachdem der Kill-Befehl gesendet wurde.
        // Da der Monitor-Task den Watcher beim regulären Exit stoppt, ist es hier vielleicht nicht
        // zwingend nötig, es sei denn, der Monitor-Task würde nicht korrekt laufen.
        // Aber für Konsistenz und falls der Kill erfolgreich ist und der Monitor nicht schnell genug ist:
        self.stop_crash_report_watcher(process_id).await;

        if let Err(e) = self.save_processes().await {
            log::error!(
                "Failed to save processes state after initiating stop for {}: {}",
                process_id,
                e
            );
        }

        if kill_successful {
            Ok(())
        } else {
            Err(AppError::ProcessKillFailed(pid_for_error))
        }
    }

    pub async fn get_process_metadata(&self, process_id: Uuid) -> Option<ProcessMetadata> {
        let processes_map = self.processes.read().await;
        processes_map
            .get(&process_id)
            .map(|entry| entry.metadata.clone())
    }

    pub async fn get_process_metadata_by_profile(&self, profile_id: Uuid) -> Vec<ProcessMetadata> {
        let processes_map = self.processes.read().await;
        processes_map
            .values()
            .filter(|entry| entry.metadata.profile_id == profile_id)
            .map(|entry| entry.metadata.clone())
            .collect()
    }

    pub async fn list_processes(&self) -> Vec<ProcessMetadata> {
        let processes_map = self.processes.read().await;
        processes_map
            .values()
            .map(|entry| entry.metadata.clone())
            .collect()
    }

    async fn periodic_process_check(
        app_handle: Arc<tauri::AppHandle>,
        processes_arc: Arc<RwLock<HashMap<Uuid, Process>>>,
        active_watchers_arc: Arc<RwLock<HashMap<Uuid, RecommendedWatcher>>>,
        notify_tx: mpsc::Sender<CrashReportNotification>,
    ) {
        let mut interval = interval(Duration::from_secs(10));
        log::info!("Starting periodic process and watcher checker task.");

        loop {
            interval.tick().await;
            log::trace!("Running periodic process and watcher check...");

            let mut pids_to_check_in_map: Vec<(Uuid, u32)> = Vec::new();
            {
                let processes_map_reader = processes_arc.read().await;
                if processes_map_reader.is_empty() {
                    log::trace!("No managed processes to check, skipping process poll.");
                    // Weiter, um verwaiste Watcher zu prüfen
                } else {
                    pids_to_check_in_map = processes_map_reader
                        .iter()
                        .map(|(id, process)| (*id, process.metadata.pid))
                        .collect();
                }
            }

            let global_state_res = State::get().await;
            if global_state_res.is_err() {
                log::error!("Periodic check: Failed to get global state. Cannot manage watchers or save state. Retrying next cycle.");
                continue;
            }
            let global_state = global_state_res.unwrap();

            let mut dead_process_ids_from_map: Vec<Uuid> = Vec::new();
            if !pids_to_check_in_map.is_empty() {
                let mut sys = System::new();
                let pids_to_refresh: Vec<Pid> = pids_to_check_in_map
                    .iter()
                    .map(|(_, pid_u32)| Pid::from(*pid_u32 as usize)) // Dereferenzieren von pid_u32
                    .collect();
                sys.refresh_processes(ProcessesToUpdate::Some(&pids_to_refresh), false);

                for (id, pid) in pids_to_check_in_map {
                    // Hier pids_to_check_in_map verwenden, nicht pids_to_refresh
                    if sys.process(Pid::from(pid as usize)).is_none() {
                        log::warn!("Periodic check found managed process {} (PID: {}) no longer running. Marking for removal.", id, pid);
                        dead_process_ids_from_map.push(id);
                    } else {
                        // Prozess läuft noch, stelle sicher, dass ein Watcher existiert, falls er aus irgendeinem Grund fehlt
                        let watchers_map_reader = active_watchers_arc.read().await;
                        let has_watcher = watchers_map_reader.contains_key(&id);
                        drop(watchers_map_reader);

                        if !has_watcher {
                            log::warn!("Periodic check: Process {} is running but has no watcher. Attempting to start one.", id);
                            // Profile ID aus der process map holen
                            let profile_id_opt = {
                                let proc_map_reader = processes_arc.read().await;
                                proc_map_reader.get(&id).map(|p| p.metadata.profile_id)
                            };
                            if let Some(profile_id) = profile_id_opt {
                                if let Ok(instance_path) = global_state
                                    .profile_manager
                                    .get_profile_instance_path(profile_id)
                                    .await
                                {
                                    let crash_reports_path = instance_path.join("crash-reports");
                                    // start_crash_report_watcher benötigt &self, also rufen wir es über global_state.process_manager auf
                                    if let Err(e) = global_state
                                        .process_manager
                                        .start_crash_report_watcher(id, &crash_reports_path)
                                        .await
                                    {
                                        log::error!("Periodic check: Failed to restart watcher for process {}: {}", id, e);
                                    }
                                } else {
                                    log::warn!("Periodic check: Could not get instance path for running process {} to restart watcher.", id);
                                }
                            } else {
                                log::warn!("Periodic check: Could not get profile_id for running process {} to restart watcher.", id);
                            }
                        }
                    }
                }
            }

            if !dead_process_ids_from_map.is_empty() {
                log::warn!(
                    "Periodic check removing {} stale process entries from map: {:?}",
                    dead_process_ids_from_map.len(),
                    dead_process_ids_from_map
                );
                let mut processes_map_writer = processes_arc.write().await;
                for id in &dead_process_ids_from_map {
                    processes_map_writer.remove(id);
                }
                drop(processes_map_writer);
                // Speichere Änderungen an der Prozessliste
                if let Err(e) = global_state.process_manager.save_processes().await {
                    log::error!(
                        "Periodic check: Failed to save processes after removing stale entries: {}",
                        e
                    );
                }
            }

            // Jetzt Watcher aufräumen: Entferne Watcher für Prozesse, die nicht mehr in der `processes_arc` Map sind
            // (entweder weil sie gerade entfernt wurden oder nie da waren, aber ein Watcher existiert)
            let mut orphaned_watcher_ids: Vec<Uuid> = Vec::new();
            {
                let watchers_map_reader = active_watchers_arc.read().await;
                let processes_map_reader = processes_arc.read().await; // Erneut lesen für aktuellen Stand
                for watcher_process_id in watchers_map_reader.keys() {
                    if !processes_map_reader.contains_key(watcher_process_id) {
                        orphaned_watcher_ids.push(*watcher_process_id);
                    }
                }
            } // Reader freigeben

            if !orphaned_watcher_ids.is_empty() {
                log::warn!(
                    "Periodic check found {} orphaned watchers. Removing them: {:?}",
                    orphaned_watcher_ids.len(),
                    orphaned_watcher_ids
                );
                // stop_crash_report_watcher benötigt &self, also über global_state.process_manager
                for id in orphaned_watcher_ids {
                    global_state
                        .process_manager
                        .stop_crash_report_watcher(id)
                        .await;
                }
            }
        }
    }

    async fn periodic_log_tailer(processes_arc: Arc<RwLock<HashMap<Uuid, Process>>>) {
        let mut interval = interval(Duration::from_secs(1)); // Log-Tailing kann weiterhin häufig sein
        log::info!("Starting periodic log tailing task (crash reports handled by notify).");

        loop {
            interval.tick().await;
            log::trace!("Running periodic log tail check...");

            let app_state_res = state::State::get().await; // Holen des globalen Zustands
            let app_state = match app_state_res {
                Ok(state) => state,
                Err(e) => {
                    log::error!(
                        "Log tailer failed to get global state: {}. Skipping cycle.",
                        e
                    );
                    continue;
                }
            };

            let processes_map_reader = processes_arc.read().await;
            if processes_map_reader.is_empty() {
                log::trace!("No processes to tail logs for.");
                drop(processes_map_reader);
                continue;
            }

            let processes_to_tail: Vec<(Uuid, Uuid, Arc<Mutex<u64>>)> = processes_map_reader
                .iter()
                .filter(|(_, process_entry)| {
                    process_entry.metadata.state == ProcessState::Running
                        || process_entry.metadata.state == ProcessState::Starting
                })
                .map(|(id, process_entry)| {
                    (
                        *id,
                        process_entry.metadata.profile_id,
                        Arc::clone(&process_entry.last_log_position),
                    )
                })
                .collect();

            drop(processes_map_reader);

            for (process_id, profile_id, last_pos_mutex) in processes_to_tail {
                let instance_path = match app_state // Verwende app_state Variable
                    .profile_manager
                    .get_profile_instance_path(profile_id)
                    .await
                {
                    Ok(path) => path,
                    Err(e) => {
                        log::warn!("Could not get instance path for profile {} (process {}): {}. Skipping log tail.", profile_id, process_id, e);
                        continue;
                    }
                };

                let latest_log_path = instance_path.join("logs").join("latest.log");
                if !latest_log_path.exists() {
                    log::trace!(
                        "Log file {:?} for process {} does not exist yet.",
                        latest_log_path,
                        process_id
                    );
                } else {
                    if let Err(e) = Self::tail_log_file(
                        &latest_log_path,
                        process_id,
                        &last_pos_mutex,
                        &app_state.event_state, // Verwende app_state Variable
                    )
                    .await
                    {
                        log::warn!(
                            "Error tailing log file {:?} for process {}: {}",
                            latest_log_path,
                            process_id,
                            e
                        );
                    }
                }
            }
        }
    }


    async fn tail_log_file(
        log_path: &PathBuf,
        process_id: Uuid,
        last_pos_mutex: &Arc<Mutex<u64>>,
        event_state: &EventState,
    ) -> Result<()> {
        let current_metadata = tokio::fs::metadata(log_path).await.map_err(AppError::Io)?;
        let current_size = current_metadata.len();

        let mut last_pos_guard = last_pos_mutex.lock().await;
        let original_last_pos = *last_pos_guard; // Store the original value from the mutex

        let mut read_from_pos = original_last_pos;
        let mut just_skipped_initial = false;

        if current_size < original_last_pos {
            log::info!("Log file {:?} seems to have rotated or shrunk (current: {}, last: {}). Resetting read position to 0.", log_path, current_size, original_last_pos);
            read_from_pos = 0;
            // After rotation, we read the new file from the start.
        } else if original_last_pos == 0 && current_size > 0 {
            // If last_pos was 0 (fresh process) and there's content,
            // set read_from_pos to current_size to skip existing lines.
            log::info!(
                "Initial tail for process {} on log {:?}. Setting read position to end of file ({}) to capture only new lines.",
                process_id,
                log_path,
                current_size
            );
            read_from_pos = current_size;
            just_skipped_initial = true;
        }

        let mut bytes_actually_read: u64 = 0;

        if current_size > read_from_pos {
            log::trace!(
                "Reading new logs from {:?} for process {} (from byte {} up to {})",
                log_path,
                process_id,
                read_from_pos,
                current_size
            );
            let file = File::open(log_path).await.map_err(AppError::Io)?;
            let mut reader = BufReader::new(file);

            reader
                .seek(std::io::SeekFrom::Start(read_from_pos))
                .await
                .map_err(AppError::Io)?;

            let mut byte_buffer = Vec::new();
            loop {
                let current_stream_pos = read_from_pos + bytes_actually_read;
                if current_stream_pos >= current_size {
                    break;
                }
                byte_buffer.clear();

                match reader.read_until(b'\n', &mut byte_buffer).await {
                    Ok(0) => break, // EOF
                    Ok(bytes) => {
                        let bytes_u64 = bytes as u64;

                        //TODO ö,ä... richtig parsen
                        let line_string = String::from_utf8_lossy(&byte_buffer);
                        let trimmed_line = line_string.trim_end();

                        if !trimmed_line.is_empty() {
                            // Mask sensitive information before sending to UI
                            let safe_line = crate::utils::security_utils::mask_sensitive_data(trimmed_line);

                            log::trace!("Sending line for {}: {}", process_id, safe_line);
                            let log_event_payload = EventPayload {
                                event_id: Uuid::new_v4(),
                                event_type: EventType::MinecraftOutput,
                                target_id: Some(process_id),
                                message: safe_line.to_string(),
                                progress: None,
                                error: None,
                            };
                            if let Err(e) = event_state.emit(log_event_payload).await {
                                log::error!("Failed to emit log update via EventState: {}", e);
                            }
                        }

                        bytes_actually_read += bytes_u64;

                        if read_from_pos + bytes_actually_read > current_size {
                            log::warn!(
                                "Read beyond expected size in log tailer for {:?}. Correcting bytes_actually_read.",
                                log_path
                            );
                            bytes_actually_read = current_size - read_from_pos; // Cap it
                            break;
                        }
                    }
                    Err(e) => {
                        log::error!("Error reading bytes from log file {:?}: {}", log_path, e);
                        if current_size > read_from_pos {
                            bytes_actually_read = current_size - read_from_pos;
                        } else {
                            bytes_actually_read = 0; // No bytes could be read or determined
                            log::warn!("Attempting to advance log position to end of current file size due to read error and unclear progress.");
                        }
                        break;
                    }
                }
            }
        } else {
            if just_skipped_initial {
                log::trace!(
                    "Skipped reading initial content for process {} in {:?}. Log position will be set to {}.",
                    process_id,
                    log_path,
                    current_size
                );
            } else {
                log::trace!(
                    "No new logs found for process {} in {:?}",
                    process_id,
                    log_path
                );
            }
        }

        // Update the stored last_log_position.
        if just_skipped_initial {
            // If we skipped, the new "last position" is the end of the file we skipped to.
            *last_pos_guard = current_size;
        } else {
            // If we read (or attempted to read), the new position is where we started plus what we read.
            *last_pos_guard = read_from_pos + bytes_actually_read;
        }

        log::trace!(
            "Updated log position for process {} to {}",
            process_id,
            *last_pos_guard
        );

        Ok(())
    }

    /// Retrieves the full content of the latest.log file for a given process.
    /// Internally accesses the global state to get the ProfileManager.
    pub async fn get_full_log_content(&self, process_id: Uuid) -> Result<String> {
        log::info!(
            "Attempting to get full log content for process {}",
            process_id
        );

        // 1. Get profile_id from this ProcessManager's state
        let process_metadata = self.get_process_metadata(process_id).await.ok_or_else(|| {
            log::warn!(
                "Process {} not found in ProcessManager when getting full log.",
                process_id
            );
            AppError::ProcessNotFound(process_id)
        })?;
        let profile_id = process_metadata.profile_id;
        log::debug!("Found profile_id {} for process {}", profile_id, process_id);

        // 2. Get instance_path using the global state
        let app_state = state::State::get().await?; // Get global state
        let instance_path = app_state
            .profile_manager
            .get_profile_instance_path(profile_id)
            .await?; // Access profile manager
        let log_path = instance_path.join("logs").join("latest.log");
        log::debug!("Constructed log path for full read: {:?}", log_path);

        // 3. Read the log file content
        if !log_path.exists() {
            log::warn!("Log file not found at path: {:?}", log_path);
            return Ok("".to_string());
        }

        // Read file as bytes first to handle potential invalid UTF-8
        let log_bytes = async_fs::read(&log_path).await.map_err(|e| {
            log::error!("Failed to read log file bytes {:?}: {}", log_path, e);
            AppError::Io(e)
        })?;

        // Convert bytes to string, replacing invalid sequences
        let log_content = String::from_utf8_lossy(&log_bytes).to_string();

        log::info!(
            "Successfully read {} bytes (lossy converted to string) from log file for process {}",
            log_bytes.len(),
            process_id
        );
        Ok(log_content)
    }

    /// Fetches the latest crash report for a given profile.
    /// Uses profile_id to locate the crash-reports directory (since process might be removed from map).
    /// If process_id is provided, emits events and stores content for that process.
    pub async fn fetch_latest_crash_report(&self, profile_id: Uuid, process_id: Option<Uuid>) -> Result<Option<String>> {
        log::info!("Manually fetching latest crash report for profile {} (process {:?})", profile_id, process_id);
        
        // 1. Get crash-reports directory path using profile_id
        let app_state = state::State::get().await?;
        let instance_path = app_state.profile_manager.get_profile_instance_path(profile_id).await?;
        let crash_reports_dir = instance_path.join("crash-reports");
        
        if !crash_reports_dir.exists() {
            log::info!("Crash reports directory does not exist for profile {}", profile_id);
            return Ok(None);
        }
        
        // 2. Find the latest crash-*.txt file by modification time
        let mut latest_crash_file: Option<(PathBuf, std::time::SystemTime)> = None;
        
        let mut entries = async_fs::read_dir(&crash_reports_dir).await.map_err(AppError::Io)?;
        while let Some(entry) = entries.next_entry().await.map_err(AppError::Io)? {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name() {
                    let name_str = file_name.to_string_lossy();
                    if name_str.starts_with("crash-") && name_str.ends_with(".txt") {
                        if let Ok(metadata) = async_fs::metadata(&path).await {
                            if let Ok(modified) = metadata.modified() {
                                match &latest_crash_file {
                                    None => latest_crash_file = Some((path.clone(), modified)),
                                    Some((_, latest_time)) if modified > *latest_time => {
                                        latest_crash_file = Some((path.clone(), modified));
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 3. If found, read content and optionally emit events
        if let Some((crash_file_path, _)) = latest_crash_file {
            log::info!("Found latest crash report: {:?}", crash_file_path);
            
            match async_fs::read_to_string(&crash_file_path).await {
                Ok(content) => {
                    // Only emit events if process_id is provided
                    if let Some(pid) = process_id {
                        let file_name = crash_file_path.file_name().unwrap_or_default().to_string_lossy();
                        let message_to_log = format!("[CRASH REPORT - {}]:\n{}", file_name, content);
                        
                        // Store content using process_id
                        self.crash_report_contents.insert(pid, content.clone());
                        log::info!("Stored crash report content for process {}", pid);
                        
                        // Emit CrashReportContentAvailable event
                        let crash_report_available_payload = crate::state::event_state::CrashReportContentAvailablePayload {
                            process_id: pid,
                            content: content.clone(),
                        };
                        let event_payload = EventPayload {
                            event_id: Uuid::new_v4(),
                            event_type: EventType::CrashReportContentAvailable,
                            target_id: Some(pid),
                            message: serde_json::to_string(&crash_report_available_payload).unwrap_or_default(),
                            progress: None,
                            error: None,
                        };
                        if let Err(e) = app_state.event_state.emit(event_payload).await {
                            log::error!("Failed to emit CrashReportContentAvailable: {}", e);
                        }
                        
                        // Emit as MinecraftOutput (for log window)
                        let log_event_payload = EventPayload {
                            event_id: Uuid::new_v4(),
                            event_type: EventType::MinecraftOutput,
                            target_id: Some(pid),
                            message: message_to_log,
                            progress: None,
                            error: None,
                        };
                        if let Err(e) = app_state.event_state.emit(log_event_payload).await {
                            log::error!("Failed to emit crash report as MinecraftOutput: {}", e);
                        } else {
                            log::info!("Emitted crash report as MinecraftOutput for log window");
                        }
                        
                        log::info!("Successfully fetched and emitted crash report for process {}", pid);
                    } else {
                        log::info!("Fetched crash report without process_id, skipping event emission");
                    }
                    
                    Ok(Some(content))
                }
                Err(e) => {
                    log::error!("Failed to read crash report file {:?}: {}", crash_file_path, e);
                    Err(AppError::Io(e))
                }
            }
        } else {
            log::info!("No crash report files found in {:?} for profile {}", crash_reports_dir, profile_id);
            Ok(None)
        }
    }

    /// Adds a task handle to the launching_processes map
    pub fn add_launching_process(&self, profile_id: Uuid, handle: JoinHandle<()>) {
        log::info!("Adding launching task for profile ID: {}", profile_id);
        self.launching_processes.insert(profile_id, handle);
    }

    /// Removes a task handle from the launching_processes map
    pub fn remove_launching_process(&self, profile_id: Uuid) {
        log::info!("Removing launching task for profile ID: {}", profile_id);
        self.launching_processes.remove(&profile_id);
    }

    /// Aborts an ongoing launch process for the given profile ID
    pub fn abort_launch_process(&self, profile_id: Uuid) -> Result<()> {
        if let Some((_, handle)) = self.launching_processes.remove(&profile_id) {
            log::info!("Aborting launch task for profile ID: {}", profile_id);

            // Abort the task
            handle.abort();
            log::info!(
                "Successfully aborted launch task for profile ID: {}",
                profile_id
            );

            return Ok(());
        } else {
            log::warn!("No launching task found for profile ID: {}", profile_id);
            return Err(AppError::Other(format!(
                "No launching task found for profile ID: {}",
                profile_id
            )));
        }
    }

    /// Checks if a profile has an ongoing launch process
    pub fn has_launching_process(&self, profile_id: Uuid) -> bool {
        self.launching_processes.contains_key(&profile_id)
    }

    // Helper function to execute post-exit hook with flatter structure
    async fn execute_post_exit_hook_if_needed(
        success: bool,
        state: &State,
        process_id: Uuid,
        removed_process_metadata: &Option<Process>,
    ) {
        // Early return if process was not successful
        if !success {
            return;
        }

        // Get hook from process metadata (captured at start time) instead of current config
        let hook = match removed_process_metadata {
            Some(process) => match &process.metadata.post_exit_hook {
                Some(h) => h,
                None => return, // No hook was configured when process started
            },
            None => return, // No process metadata available
        };

        log::info!(
            "Executing post-exit hook for process {}: {}",
            process_id,
            hook
        );

        let removed_process = match removed_process_metadata {
            Some(p) => p,
            None => {
                log::warn!(
                    "No process metadata available for post-exit hook for process {}",
                    process_id
                );
                return;
            }
        };

        let profile = match state
            .profile_manager
            .get_profile(removed_process.metadata.profile_id)
            .await
        {
            Ok(p) => p,
            Err(e) => {
                log::error!(
                    "Could not get profile for post-exit hook for process {}: {}",
                    process_id,
                    e
                );
                return;
            }
        };

        let game_directory = match state
            .profile_manager
            .calculate_instance_path_for_profile(&profile)
        {
            Ok(dir) => dir,
            Err(_) => {
                log::error!(
                    "Could not determine game directory for post-exit hook for process {}",
                    process_id
                );
                return;
            }
        };

        // Execute hook without waiting for completion (fire and forget)
        let hook_command = hook.clone();
        let game_dir_clone = game_directory.clone();
        tokio::spawn(async move {
            let mut cmd = hook_command.split(' ');
            let command = match cmd.next() {
                Some(c) => c,
                None => return,
            };

            match std::process::Command::new(command)
                .args(cmd.collect::<Vec<&str>>())
                .current_dir(&game_dir_clone)
                .spawn()
            {
                Ok(_) => {
                    log::info!(
                        "Post-exit hook spawned successfully for process {}",
                        process_id
                    );
                }
                Err(e) => {
                    log::error!(
                        "Failed to spawn post-exit hook for process {}: {}",
                        process_id,
                        e
                    );
                }
            }
        });
    }

    // Private helper to schedule the auto-opening of the log window
    fn schedule_auto_open_log_window(&self, process_id: Uuid) {
        let app_handle_clone = Arc::clone(&self.app_handle);

        tokio::spawn(async move {
            match crate::state::State::get().await {
                Ok(global_state) => {
                    let launcher_config = global_state.config_manager.get_config().await;
                    if launcher_config.open_logs_after_starting {
                        log::info!(
                            "Config: Attempting to auto-open log window for process {}",
                            process_id
                        );
                        match crate::commands::process_command::open_log_window(
                            (*app_handle_clone).clone(),
                            process_id,
                            Some(true),
                        )
                        .await
                        {
                            Ok(()) => log::info!(
                                "Log window for process {} successfully auto-opened.",
                                process_id
                            ),
                            Err(e) => log::error!(
                                "Error auto-opening log window for process {}: {:?}",
                                process_id,
                                e
                            ),
                        }
                    } else {
                        log::debug!(
                            "Config: Auto-open log window is disabled for process {}",
                            process_id
                        );
                    }
                }
                Err(e) => {
                    log::error!("Failed to get global state to check for auto-opening log window for process {}: {:?}", process_id, e);
                }
            }
        });
    }
}

#[async_trait]
impl PostInitializationHandler for ProcessManager {
    async fn on_state_ready(&self, app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        log::info!("ProcessManager: on_state_ready called. Performing post-initialization tasks.");

        // For process_crash_report_events: The task requires the receive end of an mpsc channel.
        // The most robust way is to initialize tx and rx in `new`, store rx in `self` (e.g., Arc<Mutex<Option<Receiver>>>)
        // and then .take() it here. For now, we will skip spawning this specific task here to simplify the deadlock fix.
        // This can be revisited. The deadlock was caused by `load_processes_and_watchers` calling `State::get()` too early.
        log::warn!("ProcessManager: Spawning of 'process_crash_report_events' task is TENTATIVELY SKIPPED in on_state_ready to simplify deadlock fix. Review if needed.");

        // This was the critical call causing deadlock issues
        self.load_processes_and_watchers().await?;
        log::info!("ProcessManager: Finished load_processes_and_watchers.");

        let manager_clone_periodic_check_processes = Arc::clone(&self.processes);
        let manager_clone_periodic_check_watchers = Arc::clone(&self.active_watchers);
        let app_handle_for_periodic_check = Arc::clone(&app_handle);
        let notify_tx_for_periodic_check = self.notify_event_tx.clone();

        tokio::spawn(Self::periodic_process_check(
            app_handle_for_periodic_check,
            manager_clone_periodic_check_processes,
            manager_clone_periodic_check_watchers,
            notify_tx_for_periodic_check,
        ));
        log::info!("ProcessManager: Spawned periodic_process_check task.");

        let tailer_processes_arc = Arc::clone(&self.processes);
        tokio::spawn(Self::periodic_log_tailer(tailer_processes_arc));
        log::info!("ProcessManager: Spawned periodic_log_tailer task.");

        log::info!("ProcessManager: Successfully completed on_state_ready.");
        Ok(())
    }
}

pub fn default_processes_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(PROCESSES_FILENAME)
}
