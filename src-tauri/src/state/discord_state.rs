use crate::error::{AppError, Result};
use crate::state; // Need this for State and ProcessState access
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use log::{debug, error, info, warn};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager; // Keep for app_handle.state()
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

// Discord application ID for NoRiskClient
const DISCORD_APP_ID: &str = "1237087999104122981"; // Replace with actual Discord application ID

// Different states for Discord Rich Presence
#[derive(Debug, Clone, PartialEq)]
pub enum DiscordState {
    Idle,
    // TODO: Add other states like InGame(profile_name), Editing(profile_name) etc.
}

#[derive(Clone)]
pub struct DiscordManager {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
    current_state: Arc<RwLock<DiscordState>>,
    enabled: Arc<RwLock<bool>>,
    idle_start_timestamp: Arc<RwLock<Option<i64>>>,
}

impl DiscordManager {
    pub async fn new(enabled: bool) -> Result<Self> {
        debug!(
            "Initializing Discord Rich Presence Manager (enabled: {})",
            enabled
        );

        // Get current time for initial idle timestamp
        let initial_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .ok();

        let manager = Self {
            client: Arc::new(Mutex::new(None)),
            current_state: Arc::new(RwLock::new(DiscordState::Idle)),
            enabled: Arc::new(RwLock::new(enabled)),
            idle_start_timestamp: Arc::new(RwLock::new(initial_timestamp)),
        };

        // Initialize Discord presence if enabled
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
            debug!("Discord Rich Presence is disabled");
        }
        debug!("Successfully initialized Discord Rich Presence Manager");

        Ok(manager)
    }

    async fn connect(&self) -> Result<()> {
        if !*self.enabled.read().await {
            debug!("Discord Rich Presence is disabled, skipping connection");
            return Ok(());
        }

        debug!("Attempting to connect to Discord...");
        let mut client_lock = self.client.lock().await;

        // Only initialize if not already initialized
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
                            debug!("Successfully connected to Discord client");
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
                    debug!("Successfully disconnected from Discord client");
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

    /* TODO
    lass mal brainstormen wie wir das handhaben wollen also imagine wir starten ein profil
    und dann editieren wir was im mods oder so... dann würden wir ja das spiel quasi überschreiben check?
     */
    // Public method that catches errors to prevent application crashes
    pub async fn set_state(&self, state: DiscordState, force: bool) -> Result<()> {
        debug!("Setting Discord state to: {:?}", state);
        match self.set_state_internal(state, force).await {
            Ok(_) => Ok(()),
            Err(e) => {
                error!(
                    "Error setting Discord state: {}. Continuing without Discord presence.",
                    e
                );
                // Return Ok to prevent application errors
                Ok(())
            }
        }
    }

    // Internal implementation that can be forced to update
    async fn set_state_internal(&self, state: DiscordState, force: bool) -> Result<()> {
        // Check if Discord is enabled
        if !*self.enabled.read().await {
            debug!("Discord Rich Presence is disabled, ignoring state update");
            return Ok(());
        }

        {
            let mut current_state = self.current_state.write().await;

            // Only update if state changed or forced
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

        // Lock the client and set the activity
        let mut client_lock = self.client.lock().await;

        // If client is None, try to reconnect
        if client_lock.is_none() {
            debug!("No Discord client available, attempting to reconnect...");
            drop(client_lock); // Release the lock before reconnecting
            self.connect().await?;
            client_lock = self.client.lock().await;
        }

        if let Some(client_ref) = client_lock.as_mut() {
            // Create activity for current state (pass self to access timestamp)
            let activity = self.create_activity_for_state(&state).await; // Make async

            debug!("Sending activity to Discord...");
            match client_ref
                .set_activity(activity)
                .map_err(|e| AppError::DiscordError(format!("Discord activity error: {}", e)))
            {
                Ok(_) => {
                    debug!("Successfully updated Discord Rich Presence");
                }
                Err(e) => {
                    warn!("Failed to update Discord Rich Presence: {}", e);
                    // Try to reconnect
                    debug!("Attempting to reconnect to Discord...");
                    if let Err(reconnect_e) = client_ref.reconnect().map_err(|e| {
                        AppError::DiscordError(format!("Discord reconnect error: {}", e))
                    }) {
                        error!("Failed to reconnect to Discord: {}", reconnect_e);
                        return Err(reconnect_e);
                    }

                    debug!("Reconnection successful, trying to set activity again...");
                    // Try setting activity again after reconnect with a new activity
                    let new_activity = self.create_activity_for_state(&state).await;
                    if let Err(retry_e) = client_ref.set_activity(new_activity).map_err(|e| {
                        AppError::DiscordError(format!(
                            "Discord activity error after reconnect: {}",
                            e
                        ))
                    }) {
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
            // This case should be less likely now due to the reconnect logic above
            warn!("Failed to get Discord client, cannot set activity");
        }

        Ok(())
    }

    // Make async to allow reading the timestamp lock
    async fn create_activity_for_state(&self, state: &DiscordState) -> activity::Activity {
        let icon = "icon_512px"; // Use a consistent icon name

        // TODO: Resolve button issue
        let download_button = activity::Button::new("DOWNLOAD", "https://norisk.gg/");
        let buttons = vec![download_button];

        debug!("Creating activity for Discord state: {:?}", state);
        match state {
            DiscordState::Idle => {
                // Read the idle start timestamp
                let idle_timestamp = *self.idle_start_timestamp.read().await;

                let start_time = idle_timestamp.unwrap_or_else(|| {
                    warn!("Idle state detected but no idle timestamp found. Using current time.");
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0) // Fallback if time is before epoch
                });

                activity::Activity::new()
                    .state("Idling...")
                    .assets(
                        activity::Assets::new()
                            .large_image(icon)
                            .large_text("NoRiskClient"),
                    )
                    .timestamps(activity::Timestamps::new().start(start_time))
                    .buttons(buttons) // Include buttons here
            }
        }
    }

    // Set enable/disable state
    pub async fn set_enabled(&self, enabled: bool) -> Result<()> {
        debug!("Setting Discord Rich Presence enabled: {}", enabled);
        let mut enabled_lock = self.enabled.write().await;
        let was_enabled = *enabled_lock;
        *enabled_lock = enabled;

        if !was_enabled && enabled {
            // Was disabled, now enabled - connect in background to not block app startup
            debug!("Discord was disabled, now enabled - spawning background connection...");
            drop(enabled_lock);

            // Clone self to move into spawned task
            let manager_clone = self.clone();
            tokio::spawn(async move {
                debug!("Discord: Starting background connection...");

                // Catch errors to prevent application crashes
                if let Err(e) = manager_clone.connect().await {
                    error!("Failed to connect to Discord when enabling: {}", e);
                    return;
                }

                // Set initial state and catch errors
                if let Err(e) = manager_clone.set_state_internal(DiscordState::Idle, true).await {
                    error!("Failed to set initial Discord state: {}", e);
                    return;
                }

                debug!("Discord: Background connection completed successfully.");
            });
        } else if was_enabled && !enabled {
            // Was enabled, now disabled - disconnect
            debug!("Discord was enabled, now disabled - disconnecting...");
            drop(enabled_lock);

            // Catch errors to prevent application crashes
            if let Err(e) = self.disconnect().await {
                error!("Failed to disconnect from Discord when disabling: {}", e);
                // Continue without error return
            }
        } else {
            debug!("Discord enabled state unchanged: {}", enabled);
        }

        Ok(())
    }

    /// Clears the idle start timestamp, typically called when a non-idle activity begins.
    pub async fn clear_idle_timestamp(&self) {
        if !*self.enabled.read().await {
            debug!("Discord is disabled, skipping clear_idle_timestamp.");
            return;
        }
        let mut timestamp_lock = self.idle_start_timestamp.write().await;
        if timestamp_lock.is_some() {
            debug!("Clearing Discord idle start timestamp.");
            *timestamp_lock = None;
        } else {
            debug!("Discord idle start timestamp was already None.");
        }
    }

    pub async fn get_current_state(&self) -> DiscordState {
        let state = self.current_state.read().await.clone();
        debug!("Getting current Discord state: {:?}", state);
        state
    }

    pub async fn is_enabled(&self) -> bool {
        let enabled = *self.enabled.read().await;
        debug!("Checking if Discord is enabled: {}", enabled);
        enabled
    }

    pub async fn handle_focus_event(&self) -> Result<()> {
        debug!("Handling focus event within DiscordManager.");

        if !self.is_enabled().await {
            debug!("Focus handling: DRP is disabled, doing nothing.");
            return Ok(());
        }

        // Get the global state and check processes
        let is_game_running = match state::State::get().await {
            Ok(state) => {
                // Access process manager via the successfully retrieved state
                let processes = state.process_manager.list_processes().await;
                processes
                    .iter()
                    .any(|p| p.state == state::process_state::ProcessState::Running)
            }
            Err(e) => {
                error!("Focus handling: Failed to get global state using State::get(): {}. Assuming game might be running.", e);
                // Safety measure: Assume a game *might* be running if we can't get state.
                true
            }
        };

        if !is_game_running {
            debug!(
                "Focus handling: DRP enabled, no game running. Ensuring idle timestamp and state."
            );
            self.ensure_idle_timestamp_set().await; // Ensure timestamp is set
                                                    // Force update to Idle state (will use the timestamp we just potentially set)
            self.set_state_internal(DiscordState::Idle, true).await?;
        } else {
            debug!("Focus handling: Game is running, yielding DRP control.");
        }

        Ok(())
    }

    /// Notifies the Discord manager that a game process has started.
    /// This will clear the idle timestamp if Discord is enabled.
    pub async fn notify_game_start(&self, process_id: Uuid) {
        debug!(
            "Received game start notification for process {}, clearing idle timestamp.",
            process_id
        );
        self.clear_idle_timestamp().await;
    }

    /// Ensures the idle_start_timestamp is set to the current time if it is None.
    /// This is typically called when transitioning to an Idle state when no game is running.
    async fn ensure_idle_timestamp_set(&self) {
        // This check might seem redundant if called only when DRP is enabled,
        // but it's good practice for a private helper.
        if !*self.enabled.read().await {
            return;
        }
        let mut timestamp_lock = self.idle_start_timestamp.write().await;
        if timestamp_lock.is_none() {
            debug!("ensure_idle_timestamp_set: Timestamp was None, setting to current time.");
            *timestamp_lock = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or_else(|_| {
                        error!("System time is before UNIX EPOCH!");
                        0 // Fallback timestamp
                    }),
            );
        } else {
            debug!("ensure_idle_timestamp_set: Timestamp already set.");
        }
    }
}
