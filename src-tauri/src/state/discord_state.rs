use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use log::{debug, error, info, warn};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

const DISCORD_APP_ID: &str = "1237087999104122981";

#[derive(Debug, Clone, PartialEq)]
pub enum DiscordState {
    Idle,
    Custom(String),
    InGame {
        profile_name: String,
        mc_version: String,
    },
}

#[derive(Clone)]
pub struct DiscordManager {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
    current_state: Arc<RwLock<DiscordState>>,
    enabled: Arc<RwLock<bool>>,
    idle_start_timestamp: Arc<RwLock<Option<i64>>>,
    last_client_state: Arc<RwLock<Option<String>>>,
}

impl DiscordManager {
    pub async fn new(enabled: bool) -> Result<Self> {
        info!(
            "Initializing Discord Rich Presence Manager (enabled: {})",
            enabled
        );

        let initial_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .ok();

        let manager = Self {
            client: Arc::new(Mutex::new(None)),
            current_state: Arc::new(RwLock::new(DiscordState::Idle)),
            enabled: Arc::new(RwLock::new(enabled)),
            idle_start_timestamp: Arc::new(RwLock::new(initial_timestamp)),
            last_client_state: Arc::new(RwLock::new(None)),
        };

        if enabled {
            debug!("Discord Rich Presence initially enabled, connecting...");
            if let Err(e) = manager.connect().await {
                error!("Failed to connect to Discord during initialization: {}", e);
            }
            debug!("Setting initial Discord state to Idle");
            if let Err(e) = manager.set_state_internal(DiscordState::Idle, true).await {
                error!("Failed to set initial Discord state: {}", e);
            }
        } else {
            info!("Discord Rich Presence is disabled");
        }

        // Start background poller to watch for client state file changes
        let poller_clone = manager.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                if !*poller_clone.enabled.read().await {
                    continue;
                }
                // Check if client state changed
                let new_client_state = Self::read_active_client_state()
                    .and_then(|j| j["state"].as_str().map(|s| s.to_string()));
                let mut last = poller_clone.last_client_state.write().await;
                if *last != new_client_state {
                    debug!("Client state file changed: {:?} -> {:?}", *last, new_client_state);
                    *last = new_client_state;
                    drop(last);
                    // Force re-render current state with new client info
                    let current = poller_clone.current_state.read().await.clone();
                    poller_clone.set_state_internal(current, true).await.ok();
                }
            }
        });

        info!("Successfully initialized Discord Rich Presence Manager");

        Ok(manager)
    }

    async fn connect(&self) -> Result<()> {
        if !*self.enabled.read().await {
            debug!("Discord Rich Presence is disabled, skipping connection");
            return Ok(());
        }

        debug!("Attempting to connect to Discord...");
        let mut client_lock = self.client.lock().await;

        if client_lock.is_none() {
            debug!("No existing Discord client, creating new one...");
            match DiscordIpcClient::new(DISCORD_APP_ID)
                .map_err(|e| AppError::DiscordError(format!("Discord error: {}", e)))
            {
                Ok(mut client) => {
                    debug!("Discord client created, connecting...");
                    match client.connect().map_err(|e| {
                        AppError::DiscordError(format!("Discord connection error: {}", e))
                    }) {
                        Ok(_) => {
                            info!("Successfully connected to Discord client");
                            *client_lock = Some(client);
                        }
                        Err(e) => {
                            warn!("Failed to connect to Discord client: {}", e);
                            return Err(e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to create Discord client: {}", e);
                    return Err(e);
                }
            }
        } else {
            debug!("Discord client already exists");
        }

        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        debug!("Attempting to disconnect from Discord...");
        let mut client_lock = self.client.lock().await;

        if let Some(mut client) = client_lock.take() {
            debug!("Found active Discord client, closing connection...");
            match client
                .close()
                .map_err(|e| AppError::DiscordError(format!("Discord disconnect error: {}", e)))
            {
                Ok(_) => {
                    info!("Successfully disconnected from Discord client");
                }
                Err(e) => {
                    warn!("Error disconnecting from Discord client: {}", e);
                    return Err(e);
                }
            }
        } else {
            debug!("No active Discord client to disconnect");
        }

        Ok(())
    }

    pub async fn set_state(&self, state: DiscordState, force: bool) -> Result<()> {
        debug!("Setting Discord state to: {:?}", state);
        match self.set_state_internal(state, force).await {
            Ok(_) => Ok(()),
            Err(e) => {
                error!(
                    "Error setting Discord state: {}. Continuing without Discord presence.",
                    e
                );
                Ok(())
            }
        }
    }

    async fn set_state_internal(&self, state: DiscordState, force: bool) -> Result<()> {
        if !*self.enabled.read().await {
            debug!("Discord Rich Presence is disabled, ignoring state update");
            return Ok(());
        }

        {
            let mut current_state = self.current_state.write().await;
            if !force && *current_state == state {
                debug!("Discord state unchanged, skipping update");
                return Ok(());
            }
            debug!(
                "Updating Discord state from {:?} to {:?}",
                *current_state, state
            );
            *current_state = state.clone();
        }

        // Write launcher state to shared file
        self.write_launcher_state_file(&state);

        let mut client_lock = self.client.lock().await;

        if client_lock.is_none() {
            debug!("No Discord client available, attempting to reconnect...");
            drop(client_lock);
            self.connect().await?;
            client_lock = self.client.lock().await;
        }

        if let Some(client_ref) = client_lock.as_mut() {
            debug!("Sending activity to Discord...");
            match self.build_and_set_activity(&state, client_ref).await {
                Ok(_) => {
                    debug!("Successfully updated Discord Rich Presence");
                }
                Err(e) => {
                    warn!("Failed to update Discord Rich Presence: {}", e);
                    debug!("Attempting to reconnect to Discord...");
                    if let Err(reconnect_e) = client_ref.reconnect().map_err(|e| {
                        AppError::DiscordError(format!("Discord reconnect error: {}", e))
                    }) {
                        error!("Failed to reconnect to Discord: {}", reconnect_e);
                        return Err(reconnect_e);
                    }

                    debug!("Reconnection successful, trying to set activity again...");
                    if let Err(retry_e) = self.build_and_set_activity(&state, client_ref).await {
                        error!(
                            "Failed to update Discord Rich Presence after reconnect: {}",
                            retry_e
                        );
                        return Err(retry_e);
                    }
                    debug!("Successfully updated Discord Rich Presence after reconnect");
                }
            }
        } else {
            warn!("Failed to get Discord client, cannot set activity");
        }

        Ok(())
    }

    async fn build_and_set_activity(&self, state: &DiscordState, client_ref: &mut DiscordIpcClient) -> std::result::Result<(), AppError> {
        let icon = "icon_512px";
        let download_button = activity::Button::new("DOWNLOAD", "https://norisk.gg/");
        let buttons = vec![download_button];

        let client_state = Self::read_active_client_state();
        debug!("Building activity for state: {:?}, client_active: {}", state, client_state.is_some());

        let idle_timestamp = *self.idle_start_timestamp.read().await;
        let default_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // Determine line 1 (details) and optional line 2 (state)
        // Client state file has priority when game is running
        let (line1, line2, start_time): (String, Option<String>, i64) = match state {
            DiscordState::Idle => {
                let time = idle_timestamp.unwrap_or(default_time);
                if let Some(ref client) = client_state {
                    let cl_state = client["state"].as_str().unwrap_or("Playing").to_string();
                    let cl_details = client["details"].as_str().map(|s| s.to_string());
                    (cl_state, cl_details, time)
                } else {
                    ("Idling".to_string(), None, time)
                }
            }
            DiscordState::Custom(text) => {
                let time = idle_timestamp.unwrap_or(default_time);
                if let Some(ref client) = client_state {
                    let cl_state = client["state"].as_str().unwrap_or("Playing").to_string();
                    let cl_details = client["details"].as_str().map(|s| s.to_string());
                    (cl_state, cl_details, time)
                } else {
                    (text.clone(), None, time)
                }
            }
            DiscordState::InGame { mc_version, .. } => {
                if let Some(ref client) = client_state {
                    let cl_state = client["state"].as_str().unwrap_or("In Game").to_string();
                    let cl_details = client["details"].as_str()
                        .map(|s| s.to_string())
                        .or_else(|| Some(format!("On Minecraft {}", mc_version)));
                    (cl_state, cl_details, default_time)
                } else {
                    ("In Game".to_string(), Some(format!("On Minecraft {}", mc_version)), default_time)
                }
            }
        };

        let mut activity = activity::Activity::new()
            .state(&line1);
        if let Some(ref l2) = line2 {
            activity = activity.details(l2);
        }
        let activity = activity
            .assets(
                activity::Assets::new()
                    .large_image(icon)
                    .large_text("NoRisk Client"),
            )
            .timestamps(activity::Timestamps::new().start(start_time))
            .buttons(buttons);

        client_ref.set_activity(activity)
            .map_err(|e| AppError::DiscordError(format!("Discord activity error: {}", e)))?;
        Ok(())
    }

    // --- State File Methods ---

    /// Write launcher state to shared discord directory
    fn write_launcher_state_file(&self, state: &DiscordState) {
        let discord_dir = LAUNCHER_DIRECTORY.meta_dir().join("discord");
        if std::fs::create_dir_all(&discord_dir).is_err() {
            return;
        }
        let file = discord_dir.join("launcher.json");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let (state_str, details) = match state {
            DiscordState::Idle => ("Idling".to_string(), None),
            DiscordState::Custom(text) => (text.clone(), None),
            DiscordState::InGame {
                profile_name,
                mc_version,
            } => ("In Game".to_string(), Some(format!("{} {}", profile_name, mc_version))),
        };

        let json = serde_json::json!({
            "source": "launcher",
            "state": state_str,
            "details": details,
            "timestamp": now
        });
        std::fs::write(&file, json.to_string()).ok();
    }

    /// Read the most recent active client state file (not stale, < 30s)
    fn read_active_client_state() -> Option<serde_json::Value> {
        let discord_dir = LAUNCHER_DIRECTORY.meta_dir().join("discord");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        std::fs::read_dir(&discord_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map_or(false, |n| n.starts_with("client."))
            })
            .filter_map(|e| {
                let content = std::fs::read_to_string(e.path()).ok()?;
                let json: serde_json::Value = serde_json::from_str(&content).ok()?;
                let timestamp = json["timestamp"].as_u64()?;
                if now.saturating_sub(timestamp) > 30_000 {
                    // Stale — cleanup
                    std::fs::remove_file(e.path()).ok();
                    return None;
                }
                Some(json)
            })
            .max_by_key(|j| j["timestamp"].as_u64().unwrap_or(0))
    }

    /// Cleanup all client state files (called when game stops)
    fn cleanup_client_files() {
        let discord_dir = LAUNCHER_DIRECTORY.meta_dir().join("discord");
        if let Ok(entries) = std::fs::read_dir(&discord_dir) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_str()
                    .map_or(false, |n| n.starts_with("client."))
                {
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }

    /// Cleanup launcher state file (called on shutdown)
    pub fn cleanup_launcher_file() {
        let file = LAUNCHER_DIRECTORY.meta_dir().join("discord").join("launcher.json");
        std::fs::remove_file(&file).ok();
    }

    // --- Public API ---

    pub async fn set_enabled(&self, enabled: bool) -> Result<()> {
        debug!("Setting Discord Rich Presence enabled: {}", enabled);
        let mut enabled_lock = self.enabled.write().await;
        let was_enabled = *enabled_lock;
        *enabled_lock = enabled;

        if !was_enabled && enabled {
            debug!("Discord was disabled, now enabled - spawning background connection...");
            drop(enabled_lock);

            let manager_clone = self.clone();
            tokio::spawn(async move {
                info!("Discord: Starting background connection...");
                if let Err(e) = manager_clone.connect().await {
                    error!("Failed to connect to Discord when enabling: {}", e);
                    return;
                }
                if let Err(e) = manager_clone
                    .set_state_internal(DiscordState::Idle, true)
                    .await
                {
                    error!("Failed to set initial Discord state: {}", e);
                    return;
                }
                info!("Discord: Background connection completed successfully.");
            });
        } else if was_enabled && !enabled {
            debug!("Discord was enabled, now disabled - disconnecting...");
            drop(enabled_lock);
            if let Err(e) = self.disconnect().await {
                error!("Failed to disconnect from Discord when disabling: {}", e);
            }
        } else {
            debug!("Discord enabled state unchanged: {}", enabled);
        }

        Ok(())
    }

    pub async fn clear_idle_timestamp(&self) {
        if !*self.enabled.read().await {
            return;
        }
        let mut timestamp_lock = self.idle_start_timestamp.write().await;
        if timestamp_lock.is_some() {
            debug!("Clearing Discord idle start timestamp.");
            *timestamp_lock = None;
        }
    }

    pub async fn get_current_state(&self) -> DiscordState {
        self.current_state.read().await.clone()
    }

    pub async fn is_enabled(&self) -> bool {
        *self.enabled.read().await
    }

    pub async fn handle_focus_event(&self) -> Result<()> {
        debug!("Handling focus event within DiscordManager.");

        if !self.is_enabled().await {
            return Ok(());
        }

        // Re-apply the current state (force=true to refresh Discord with latest client files)
        let current = self.current_state.read().await.clone();
        debug!("Focus handling: Re-applying current state: {:?}", current);
        self.set_state_internal(current, true).await?;

        Ok(())
    }

    pub async fn set_custom_state(&self, text: String) {
        self.set_state(DiscordState::Custom(text), false).await.ok();
    }

    pub async fn notify_game_start(
        &self,
        process_id: Uuid,
        profile_name: Option<String>,
        mc_version: Option<String>,
    ) {
        debug!(
            "Game start notification for process {}: profile={:?}, version={:?}",
            process_id, profile_name, mc_version
        );
        self.clear_idle_timestamp().await;

        if let (Some(name), Some(version)) = (profile_name, mc_version) {
            self.set_state(
                DiscordState::InGame {
                    profile_name: name,
                    mc_version: version,
                },
                true,
            )
            .await
            .ok();
        }
    }

    pub async fn notify_game_stop(&self, process_id: Uuid) {
        debug!("Game stop notification for process {}", process_id);
        Self::cleanup_client_files();
        self.ensure_idle_timestamp_set().await;
        self.set_state(DiscordState::Idle, true).await.ok();
    }

    async fn ensure_idle_timestamp_set(&self) {
        if !*self.enabled.read().await {
            return;
        }
        let mut timestamp_lock = self.idle_start_timestamp.write().await;
        if timestamp_lock.is_none() {
            debug!("Setting idle timestamp to current time.");
            *timestamp_lock = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
            );
        }
    }
}
