use crate::analytics::{AnalyticsConfig, AnalyticsManager, PayloadFormat};
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::minecraft_auth::MinecraftAuthStore;
use crate::state::config_state::ConfigManager;
use crate::state::discord_state::DiscordManager;
use crate::state::event_state::{EventPayload, EventState};
use crate::state::norisk_packs_state::{default_norisk_packs_path, NoriskPackManager};
use crate::state::norisk_versions_state::{default_norisk_versions_path, NoriskVersionManager};
use crate::state::post_init::PostInitializationHandler;
use crate::state::process_state::{default_processes_path, ProcessManager};
use crate::state::profile_state::ProfileManager;
use crate::state::skin_state::{default_skins_path, SkinManager};
use std::sync::Arc;
use tokio::sync::{OnceCell, Semaphore};

// Global state that will be initialized once
static LAUNCHER_STATE: OnceCell<Arc<State>> = OnceCell::const_new();

pub struct State {
    // Basic state properties will be added here
    pub initialized: bool, // This flag now signifies full post-init completion
    pub profile_manager: ProfileManager,
    pub event_state: EventState,
    pub process_manager: ProcessManager,
    pub minecraft_account_manager_v2: MinecraftAuthStore,
    pub norisk_pack_manager: NoriskPackManager,
    pub norisk_version_manager: NoriskVersionManager,
    pub config_manager: ConfigManager,
    pub skin_manager: SkinManager,
    pub discord_manager: DiscordManager,
    pub io_semaphore: Arc<Semaphore>,
    pub analytics_manager: AnalyticsManager,
}

impl State {
    // Initialize the global state
    pub async fn init(app: Arc<tauri::AppHandle>) -> Result<()> {
        let initial_state_arc = LAUNCHER_STATE
            .get_or_try_init(|| async {
                log::info!("State::init - Starting primary initialization of managers (Phase 1 - Lightweight Instantiation)...");
                let config_manager = ConfigManager::new()?;
                let discord_manager = DiscordManager::new(false).await?;
                let io_semaphore = Arc::new(Semaphore::new(10));
                let event_state = EventState::new(Some(app.clone()));
                let minecraft_account_manager_v2 = MinecraftAuthStore::new().await?;
                let norisk_pack_manager = NoriskPackManager::new(default_norisk_packs_path())?;
                let norisk_version_manager = NoriskVersionManager::new(default_norisk_versions_path())?;
                let skin_manager = SkinManager::new(default_skins_path())?;
                let profile_manager = ProfileManager::new(LAUNCHER_DIRECTORY.root_dir().join("profiles.json"))?;
                let process_manager = ProcessManager::new(default_processes_path(), app.clone()).await?;

                // Initialize analytics with localhost for testing
                let analytics_config = AnalyticsConfig {
                    enabled: true,
                    endpoint_url: "http://127.0.0.1:9090/api/track".to_string(),
                    headers: {
                        let mut h = std::collections::HashMap::new();
                        h.insert("X-Client-Version".to_string(), env!("CARGO_PKG_VERSION").to_string());
                        h.insert("X-Platform".to_string(), std::env::consts::OS.to_string());
                        h
                    },
                    payload_format: PayloadFormat::CustomWrapper {
                        events_key: "events".to_string(),
                        wrapper_fields: {
                            let mut w = std::collections::HashMap::new();
                            w.insert("launcher_version".to_string(), serde_json::json!(env!("CARGO_PKG_VERSION")));
                            w.insert("platform".to_string(), serde_json::json!(std::env::consts::OS));
                            w
                        },
                    },
                    batch_size: 1, // Send immediately for testing
                    batch_interval_secs: 5,
                    enable_retry: false, // Disabled for localhost testing
                    max_retries: 0,
                    request_timeout_secs: 5,
                };
                let analytics_storage_dir = LAUNCHER_DIRECTORY.root_dir().join("analytics");
                let analytics_manager = AnalyticsManager::new(analytics_config, analytics_storage_dir.clone());
                log::info!("======================================");
                log::info!("[Analytics] Manager initialized!");
                log::info!("[Analytics] Endpoint: http://127.0.0.1:9090/api/track");
                log::info!("[Analytics] Storage: {:?}", analytics_storage_dir);
                log::info!("[Analytics] Batch size: 1 event (immediate send for testing)");
                log::info!("[Analytics] Batch interval: 5 seconds");
                log::info!("======================================");

                log::info!("State::init - Primary initialization of managers complete (Phase 1). Constructing State struct with initialized: false.");
                Ok::<Arc<State>, AppError>(Arc::new(Self {
                    initialized: true,
                    profile_manager,
                    event_state,
                    process_manager,
                    minecraft_account_manager_v2,
                    norisk_pack_manager,
                    norisk_version_manager,
                    config_manager,
                    skin_manager,
                    discord_manager,
                    io_semaphore,
                    analytics_manager,
                }))
            })
            .await?;

        log::info!("State::init - Global state Arc created. Running post-initialization handlers (Phase 2)...");

        initial_state_arc
            .config_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - ConfigManager post-initialization complete.");

        let loaded_config = initial_state_arc.config_manager.get_config().await;

        if initial_state_arc.io_semaphore.available_permits() != loaded_config.concurrent_io_limit {
            log::warn!(
                "State::init - io_semaphore was initialized with default limit ({}). Actual config limit is {}. Consider refactoring io_semaphore for dynamic updates if this discrepancy is an issue.", 
                initial_state_arc.io_semaphore.available_permits(), // This shows current permits, not initial limit
                loaded_config.concurrent_io_limit
            );
        }

        initial_state_arc
            .discord_manager
            .set_enabled(loaded_config.enable_discord_presence)
            .await?;
        log::info!(
            "State::init - DiscordManager enabled status set based on loaded config: {}",
            loaded_config.enable_discord_presence
        );

        initial_state_arc
            .norisk_version_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - NoriskVersionManager post-initialization complete.");

        initial_state_arc
            .norisk_pack_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - NoriskPackManager post-initialization complete.");

        initial_state_arc
            .profile_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - ProfileManager post-initialization complete.");

        initial_state_arc
            .process_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - ProcessManager post-initialization complete.");

        initial_state_arc
            .skin_manager
            .on_state_ready(app.clone())
            .await?;
        log::info!("State::init - SkinManager post-initialization complete.");

        initial_state_arc
            .norisk_pack_manager
            .print_current_config()
            .await;
        initial_state_arc
            .norisk_version_manager
            .print_current_config()
            .await;

        let final_config = initial_state_arc.config_manager.get_config().await;
        tracing::info!(
            "Launcher Config - Experimental mode: {}",
            final_config.is_experimental
        );
        tracing::info!(
            "Launcher Config - Discord Rich Presence: {}",
            final_config.enable_discord_presence
        );

        log::info!(
            "State::init - Full initialization, including all post-init handlers, complete."
        );

        // Track launcher start event
        log::info!("======================================");
        log::info!("[Analytics] Tracking launcher_started event NOW");
        log::info!("======================================");
        initial_state_arc.analytics_manager.track("launcher_started");
        log::info!("[Analytics] launcher_started event call completed");

        Ok(())
    }

    // Get the current state instance
    pub async fn get() -> Result<Arc<Self>> {
        if !LAUNCHER_STATE.initialized() {
            log::error!("Attempted to get state before initialization. Waiting...");
            let mut wait_count = 0;
            while !LAUNCHER_STATE.initialized() {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                wait_count += 1;
                if wait_count % 10 == 0 {
                    // Log every second
                    log::warn!("Still waiting for state initialization in State::get() after {} attempts...", wait_count);
                }
            }
            log::info!(
                "State has been initialized after {} attempts. Proceeding in State::get().",
                wait_count
            );
        }

        Ok(Arc::clone(
            LAUNCHER_STATE.get().expect("State is not initialized!"),
        ))
    }

    // Check if state is initialized
    pub fn initialized() -> bool {
        LAUNCHER_STATE.initialized()
    }

    // Emit an event to the frontend
    pub async fn emit_event(&self, payload: EventPayload) -> Result<()> {
        self.event_state.emit(payload).await
    }
}
