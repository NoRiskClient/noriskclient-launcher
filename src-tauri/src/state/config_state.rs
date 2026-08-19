use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY, update_custom_game_dir};
use crate::error::Result;
use crate::state::post_init::PostInitializationHandler;
use crate::state::profile_state::MemorySettings;
use async_trait::async_trait;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

const CONFIG_FILENAME: &str = "launcher_config.json";
const CONFIG_CURRENT_VERSION: u32 = 1;

/// Game initialization hooks
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Hooks {
    pub pre_launch: Option<String>,
    pub wrapper: Option<String>,
    pub post_exit: Option<String>,
}

/// Referral tracking state - keeps code even after redemption for tracing
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct ReferralState {
    /// The download UUID from the installer filename
    pub code: String,
    /// Whether the code has been successfully reported to backend
    #[serde(default)]
    pub redeemed: bool,
    /// Timestamp when the code was redeemed
    #[serde(default)]
    pub redeemed_at: Option<i64>,
    /// Account UUID that redeemed the code
    #[serde(default)]
    pub redeemed_by_account: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QualityPreset {
    Low,
    Standard,
    High,
    Custom,
}

impl Default for QualityPreset {
    fn default() -> Self {
        QualityPreset::Standard
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualitySpec {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
}

pub const CUSTOM_RESOLUTIONS: [(u32, u32); 4] = [(640, 360), (854, 480), (1280, 720), (1920, 1080)];
pub const CUSTOM_FPS: [u32; 5] = [24, 30, 60, 120, 144];
pub const CUSTOM_BITRATES_KBPS: [u32; 11] = [
    3_000, 5_000, 7_000, 10_000, 15_000, 20_000, 25_000, 30_000, 50_000, 70_000, 100_000,
];

const MIN_WIDTH: u32 = 160;
const MAX_WIDTH: u32 = 3840;
const MIN_HEIGHT: u32 = 120;
const MAX_HEIGHT: u32 = 2160;
const MIN_FPS: u32 = 10;
const MAX_FPS: u32 = 240;
const MIN_BITRATE_KBPS: u32 = 500;
const MAX_BITRATE_KBPS: u32 = 200_000;

pub const MIN_CLIP_SECONDS: u32 = 5;
pub const MAX_CLIP_SECONDS: u32 = 120;

pub const BUFFER_HEADROOM_SECONDS: u32 = 5;

impl QualityPreset {
    pub fn spec(&self) -> Option<QualitySpec> {
        match self {
            QualityPreset::Low => Some(QualitySpec { width: 640, height: 360, fps: 24, bitrate_kbps: 2_000 }),
            QualityPreset::Standard => Some(QualitySpec { width: 1280, height: 720, fps: 60, bitrate_kbps: 7_000 }),
            QualityPreset::High => Some(QualitySpec { width: 1920, height: 1080, fps: 60, bitrate_kbps: 12_000 }),
            QualityPreset::Custom => None,
        }
    }

    pub fn matching(spec: QualitySpec) -> QualityPreset {
        for preset in [QualityPreset::Low, QualityPreset::Standard, QualityPreset::High] {
            if preset.spec() == Some(spec) {
                return preset;
            }
        }
        QualityPreset::Custom
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ClipConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub quality: Option<QualityPreset>,
    #[serde(default = "default_clip_width")]
    pub width: u32,
    #[serde(default = "default_clip_height")]
    pub height: u32,
    #[serde(default = "default_clip_fps")]
    pub fps: u32,
    #[serde(default = "default_clip_bitrate")]
    pub bitrate_kbps: u32,
    #[serde(default)]
    pub codec: norisk_ipc::ClipCodec,
    #[serde(default = "default_clip_encoder")]
    pub encoder: String,
    #[serde(default = "default_true_bool")]
    pub capture_audio: bool,
    #[serde(default)]
    pub audio_source: norisk_ipc::AudioSourceChoice,
    #[serde(default)]
    pub audio_device_id: Option<String>,
    #[serde(default = "default_volume")]
    pub game_volume: u32,
    #[serde(default = "default_volume")]
    pub other_volume: u32,
    #[serde(default)]
    pub capture_microphone: bool,
    #[serde(default)]
    pub microphone_device_id: Option<String>,
    #[serde(default = "default_volume")]
    pub microphone_volume: u32,
    #[serde(default)]
    pub output_dir: Option<PathBuf>,
    #[serde(default = "default_clip_max_storage_gb")]
    pub max_storage_gb: u32,
    #[serde(default = "default_clip_pre_roll")]
    pub pre_roll_seconds: u32,
    #[serde(default)]
    pub post_roll_seconds: u32,
    #[serde(default = "default_clip_hotkey_save")]
    pub hotkey_save: String,
    #[serde(default = "default_clip_hotkey_toggle")]
    pub hotkey_toggle: String,
}

impl Default for ClipConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            quality: Some(QualityPreset::default()),
            width: default_clip_width(),
            height: default_clip_height(),
            fps: default_clip_fps(),
            bitrate_kbps: default_clip_bitrate(),
            codec: norisk_ipc::ClipCodec::default(),
            encoder: default_clip_encoder(),
            capture_audio: true,
            audio_source: norisk_ipc::AudioSourceChoice::default(),
            audio_device_id: None,
            game_volume: default_volume(),
            other_volume: default_volume(),
            capture_microphone: false,
            microphone_device_id: None,
            microphone_volume: default_volume(),
            output_dir: None,
            max_storage_gb: default_clip_max_storage_gb(),
            pre_roll_seconds: default_clip_pre_roll(),
            post_roll_seconds: 0,
            hotkey_save: default_clip_hotkey_save(),
            hotkey_toggle: default_clip_hotkey_toggle(),
        }
    }
}

impl ClipConfig {
    pub fn resolved_output_dir(&self) -> PathBuf {
        self.output_dir
            .clone()
            .unwrap_or_else(|| LAUNCHER_DIRECTORY.root_dir().join("clips"))
    }

    pub fn normalize(&mut self) {
        if self.quality.is_none() {
            self.quality = Some(QualityPreset::matching(QualitySpec {
                width: self.width,
                height: self.height,
                fps: self.fps,
                bitrate_kbps: self.bitrate_kbps,
            }));
        }
    }

    pub fn preset(&self) -> QualityPreset {
        self.quality.unwrap_or_else(|| {
            QualityPreset::matching(QualitySpec {
                width: self.width,
                height: self.height,
                fps: self.fps,
                bitrate_kbps: self.bitrate_kbps,
            })
        })
    }

    pub fn effective_quality(&self) -> QualitySpec {
        self.preset().spec().unwrap_or(QualitySpec {
            width: self.width.clamp(MIN_WIDTH, MAX_WIDTH) & !1,
            height: self.height.clamp(MIN_HEIGHT, MAX_HEIGHT) & !1,
            fps: self.fps.clamp(MIN_FPS, MAX_FPS),
            bitrate_kbps: self.bitrate_kbps.clamp(MIN_BITRATE_KBPS, MAX_BITRATE_KBPS),
        })
    }

    pub fn effective_buffer_seconds(&self) -> u32 {
        self.pre_roll_seconds
            .saturating_add(BUFFER_HEADROOM_SECONDS)
            .clamp(MIN_CLIP_SECONDS, MAX_CLIP_SECONDS + BUFFER_HEADROOM_SECONDS)
    }

    pub fn estimated_buffer_bytes(&self) -> u64 {
        let quality = self.effective_quality();
        let seconds = self.effective_buffer_seconds() as u64;
        let video = quality.bitrate_kbps as u64 * 1000 / 8 * seconds;
        let audio = if self.capture_audio {
            160_u64 * 1000 / 8 * seconds
        } else {
            0
        };
        video + audio
    }

    pub fn to_capture_config(&self) -> norisk_ipc::CaptureConfig {
        use norisk_ipc::EncoderPreference;
        let quality = self.effective_quality();
        norisk_ipc::CaptureConfig {
            width: quality.width,
            height: quality.height,
            fps: quality.fps,
            bitrate_kbps: quality.bitrate_kbps,
            buffer_seconds: self.effective_buffer_seconds(),
            gop_seconds: 2.0,
            codec: self.codec,
            encoder: match self.encoder.as_str() {
                "nvenc" => EncoderPreference::Nvenc,
                "amf" => EncoderPreference::Amf,
                "quick_sync" => EncoderPreference::QuickSync,
                "software" => EncoderPreference::Software,
                _ => EncoderPreference::Auto,
            },
            capture_audio: self.capture_audio,
            audio_source: self.audio_source,
            audio_device_id: self.audio_device_id.clone(),
            game_volume: self.game_volume,
            other_volume: self.other_volume,
            capture_microphone: self.capture_microphone,
            microphone_device_id: self.microphone_device_id.clone(),
            microphone_volume: self.microphone_volume,
            output_dir: self.resolved_output_dir(),
        }
    }
}

fn default_clip_spec() -> QualitySpec {
    QualityPreset::default()
        .spec()
        .expect("the default preset is never Custom")
}
fn default_clip_width() -> u32 {
    default_clip_spec().width
}
fn default_clip_height() -> u32 {
    default_clip_spec().height
}
fn default_clip_fps() -> u32 {
    default_clip_spec().fps
}
fn default_clip_bitrate() -> u32 {
    default_clip_spec().bitrate_kbps
}
fn default_volume() -> u32 {
    100
}
fn default_clip_encoder() -> String {
    "auto".to_string()
}
fn default_clip_max_storage_gb() -> u32 {
    20
}

fn default_clip_pre_roll() -> u32 {
    30
}
fn default_clip_hotkey_save() -> String {
    "F8".to_string()
}
fn default_clip_hotkey_toggle() -> String {
    "Shift+F8".to_string()
}
fn default_true_bool() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LauncherConfig {
    #[serde(default = "default_config_version")]
    pub version: u32,
    #[serde(default)]
    pub is_experimental: bool,
    // Add more configuration options as needed:
    #[serde(default)]
    pub auto_check_updates: bool,
    #[serde(default = "default_concurrent_downloads")]
    pub concurrent_downloads: usize,
    #[serde(default = "default_discord_presence")]
    pub enable_discord_presence: bool,
    #[serde(default)]
    pub check_beta_channel: bool,
    #[serde(default = "default_profile_grouping_criterion")]
    pub profile_grouping_criterion: Option<String>,
    #[serde(default = "default_open_logs_after_starting")]
    pub open_logs_after_starting: bool,
    #[serde(default = "default_concurrent_io_limit")]
    pub concurrent_io_limit: usize,
    #[serde(default)]
    pub last_played_profile: Option<Uuid>,
    #[serde(default)]
    pub hooks: Hooks,
    #[serde(default = "default_hide_on_process_start")]
    pub hide_on_process_start: bool,
    #[serde(default = "default_global_memory_settings")]
    pub global_memory_settings: MemorySettings,
    #[serde(default)]
    pub global_custom_jvm_args: Option<String>,
    #[serde(default)]
    pub custom_game_directory: Option<PathBuf>,
    #[serde(default = "default_enable_analytics")]
    pub enable_analytics: bool,
    #[serde(default = "default_use_browser_based_login")]
    pub use_browser_based_login: bool,
    #[serde(default = "default_cache_natives_extraction")]
    pub cache_natives_extraction: bool,
    /// Referral tracking state - code stays even after redemption
    #[serde(default)]
    pub referral_state: Option<ReferralState>,
    /// Pack rollout override: "auto" | "off" | "on"
    #[serde(default = "default_pack_rollout_override")]
    pub pack_rollout_override: String,
    #[serde(default)]
    pub clips: ClipConfig,
}

fn default_config_version() -> u32 {
    CONFIG_CURRENT_VERSION
}

fn default_concurrent_downloads() -> usize {
    5
}

fn default_discord_presence() -> bool {
    true
}

fn default_profile_grouping_criterion() -> Option<String> {
    Some("group".to_string()) // Default to "group"
}

fn default_open_logs_after_starting() -> bool {
    true
}

fn default_concurrent_io_limit() -> usize {
    10 // Default based on CONCURRENT_IO_LIMIT in state_manager.rs
}

fn default_hide_on_process_start() -> bool {
    false
}

fn default_global_memory_settings() -> MemorySettings {
    const PREVIOUS_DEFAULT_MB: u32 = 3072;
    MemorySettings {
        min: PREVIOUS_DEFAULT_MB,
        max: crate::state::profile_state::default_memory_max_mb().max(PREVIOUS_DEFAULT_MB),
    }
}

fn default_enable_analytics() -> bool {
    false
}

fn default_use_browser_based_login() -> bool {
    false
}

fn default_cache_natives_extraction() -> bool {
    true
}

fn default_pack_rollout_override() -> String {
    "auto".to_string()
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_CURRENT_VERSION,
            is_experimental: false,
            auto_check_updates: true,
            concurrent_downloads: default_concurrent_downloads(),
            enable_discord_presence: default_discord_presence(),
            check_beta_channel: false,
            profile_grouping_criterion: default_profile_grouping_criterion(),
            open_logs_after_starting: default_open_logs_after_starting(),
            concurrent_io_limit: default_concurrent_io_limit(),
            last_played_profile: None,
            hooks: Hooks::default(),
            hide_on_process_start: default_hide_on_process_start(),
            global_memory_settings: default_global_memory_settings(),
            global_custom_jvm_args: None,
            custom_game_directory: None,
            enable_analytics: default_enable_analytics(),
            use_browser_based_login: default_use_browser_based_login(),
            cache_natives_extraction: default_cache_natives_extraction(),
            referral_state: None,
            pack_rollout_override: default_pack_rollout_override(),
            clips: ClipConfig::default(),
        }
    }
}

pub struct ConfigManager {
    config: Arc<RwLock<LauncherConfig>>,
    config_path: PathBuf,
    save_lock: Mutex<()>,
}

impl ConfigManager {
    pub fn new() -> Result<Self> {
        let config_path = LAUNCHER_DIRECTORY.root_dir().join(CONFIG_FILENAME);
        info!(
            "ConfigManager: Initializing with path: {:?} (config loading deferred)",
            config_path
        );

        Ok(Self {
            config: Arc::new(RwLock::new(LauncherConfig::default())),
            config_path,
            save_lock: Mutex::new(()),
        })
    }

    async fn load_config_internal(&self) -> Result<()> {
        if !self.config_path.exists() {
            info!("Config file not found, using default configuration");
            // Save the default config
            self.save_config().await?;
            return Ok(());
        }

        info!(
            "Loading launcher configuration from: {:?}",
            self.config_path
        );
        let config_data = fs::read_to_string(&self.config_path).await?;

        match serde_json::from_str::<LauncherConfig>(&config_data) {
            Ok(mut loaded_config) => {
                info!("Successfully loaded launcher configuration");
                debug!("Loaded config: {:?}", loaded_config);

                loaded_config.clips.normalize();

                // Update the stored config
                let mut config = self.config.write().await;
                *config = loaded_config.clone();

                // Update cache
                update_custom_game_dir(loaded_config.custom_game_directory);
            }
            Err(e) => {
                error!("Failed to parse config file: {}", e);
                warn!("Attempting to migrate or preserve existing settings...");

                // Try to parse as generic JSON first to preserve user settings
                match serde_json::from_str::<serde_json::Value>(&config_data) {
                    Ok(json_value) => {
                        info!("Config file is valid JSON, attempting migration...");

                        // Create backup of original config
                        let backup_path = self.config_path.with_extension("json.backup");
                        if let Err(backup_err) = fs::copy(&self.config_path, &backup_path).await {
                            warn!("Failed to create config backup: {}", backup_err);
                        } else {
                            info!("Created config backup at: {:?}", backup_path);
                        }

                        // Start with default config and try to migrate settings
                        let mut migrated_config = LauncherConfig::default();

                        // Migrate known fields that might exist
                        if let Some(obj) = json_value.as_object() {
                            // Migrate simple boolean fields
                            if let Some(exp) = obj.get("is_experimental").and_then(|v| v.as_bool()) {
                                migrated_config.is_experimental = exp;
                            }
                            if let Some(auto_check) = obj.get("auto_check_updates").and_then(|v| v.as_bool()) {
                                migrated_config.auto_check_updates = auto_check;
                            }
                            if let Some(discord) = obj.get("enable_discord_presence").and_then(|v| v.as_bool()) {
                                migrated_config.enable_discord_presence = discord;
                            }
                            if let Some(beta) = obj.get("check_beta_channel").and_then(|v| v.as_bool()) {
                                migrated_config.check_beta_channel = beta;
                            }
                            if let Some(logs) = obj.get("open_logs_after_starting").and_then(|v| v.as_bool()) {
                                migrated_config.open_logs_after_starting = logs;
                            }
                            if let Some(hide) = obj.get("hide_on_process_start").and_then(|v| v.as_bool()) {
                                migrated_config.hide_on_process_start = hide;
                            }
                            if let Some(analytics) = obj.get("enable_analytics").and_then(|v| v.as_bool()) {
                                migrated_config.enable_analytics = analytics;
                            }
                            if let Some(browser_login) = obj.get("use_browser_based_login").and_then(|v| v.as_bool()) {
                                migrated_config.use_browser_based_login = browser_login;
                            }
                            if let Some(cache_natives) = obj.get("cache_natives_extraction").and_then(|v| v.as_bool()) {
                                migrated_config.cache_natives_extraction = cache_natives;
                            }


                            // Migrate numeric fields
                            if let Some(downloads) = obj.get("concurrent_downloads").and_then(|v| v.as_u64()) {
                                if downloads > 0 && downloads <= 20 { // Reasonable bounds
                                    migrated_config.concurrent_downloads = downloads as usize;
                                }
                            }
                            if let Some(io_limit) = obj.get("concurrent_io_limit").and_then(|v| v.as_u64()) {
                                if io_limit > 0 && io_limit <= 50 { // Reasonable bounds
                                    migrated_config.concurrent_io_limit = io_limit as usize;
                                }
                            }

                            // Migrate string fields
                            if let Some(grouping) = obj.get("profile_grouping_criterion").and_then(|v| v.as_str()) {
                                // Validate known values and migrate "none" to "group"
                                match grouping {
                                    "loader" | "game_version" | "group" => {
                                        migrated_config.profile_grouping_criterion = Some(grouping.to_string());
                                    }
                                    "none" => {
                                        warn!("Migrating legacy 'none' grouping to 'group'");
                                        migrated_config.profile_grouping_criterion = Some("group".to_string());
                                    }
                                    _ => {
                                        warn!("Unknown grouping criterion '{}', using default", grouping);
                                    }
                                }
                            }

                            // Migrate UUID fields (with validation)
                            if let Some(profile_str) = obj.get("last_played_profile").and_then(|v| v.as_str()) {
                                if let Ok(uuid) = Uuid::parse_str(profile_str) {
                                    migrated_config.last_played_profile = Some(uuid);
                                }
                            }

                            // Migrate custom game directory
                            if let Some(custom_dir_str) = obj.get("custom_game_directory").and_then(|v| v.as_str()) {
                                migrated_config.custom_game_directory = Some(PathBuf::from(custom_dir_str));
                            }
                        }

                        info!("Migration completed, saving migrated configuration");
                        let mut config = self.config.write().await;
                        *config = migrated_config.clone();
                        drop(config); // Release lock before save

                        // Save the migrated config
                        self.save_config().await?;

                        // Update cache
                        update_custom_game_dir(migrated_config.custom_game_directory);
                    }
                    Err(json_err) => {
                        error!("Config file is not valid JSON: {}", json_err);
                        warn!("Config file is corrupted, creating backup and using defaults");

                        // Create backup of corrupted file
                        let backup_path = self.config_path.with_extension("json.corrupted");
                        if let Err(backup_err) = fs::copy(&self.config_path, &backup_path).await {
                            error!("Failed to backup corrupted config: {}", backup_err);
                        } else {
                            info!("Backed up corrupted config to: {:?}", backup_path);
                        }

                        // Use default config and save it
                        self.save_config().await?;
                    }
                }
            }
        }

        Ok(())
    }

    pub async fn save_config(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;
        debug!("Acquired save lock, proceeding to save config...");

        // Ensure directory exists
        if let Some(parent_dir) = self.config_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
            }
        }

        let config = self.config.read().await;
        let config_data = serde_json::to_string_pretty(&*config)?;

        fs::write(&self.config_path, config_data).await?;
        info!(
            "Successfully saved launcher configuration to: {:?}",
            self.config_path
        );

        Ok(())
    }

    // Public methods for accessing and modifying configuration

    pub async fn get_config(&self) -> LauncherConfig {
        self.config.read().await.clone()
    }

    pub async fn is_experimental_mode(&self) -> bool {
        self.config.read().await.is_experimental
    }

    pub async fn set_config(&self, new_config: LauncherConfig) -> Result<()> {
        let should_save = {
            let mut config = self.config.write().await;
            let current = &*config;
            if !differs_ignoring_version(current, &new_config) {
                debug!("No config changes detected, skipping save");
                false
            } else {
                // Preserve version during replacement
                let version = config.version;

                // Log changes
                if current.is_experimental != new_config.is_experimental {
                    info!(
                        "Changing experimental mode: {} -> {}",
                        current.is_experimental, new_config.is_experimental
                    );
                }
                if current.auto_check_updates != new_config.auto_check_updates {
                    info!(
                        "Changing auto check updates: {} -> {}",
                        current.auto_check_updates, new_config.auto_check_updates
                    );
                }
                if current.concurrent_downloads != new_config.concurrent_downloads {
                    info!(
                        "Changing concurrent downloads: {} -> {}",
                        current.concurrent_downloads, new_config.concurrent_downloads
                    );
                }
                if current.enable_discord_presence != new_config.enable_discord_presence {
                    info!(
                        "Changing Discord Rich Presence: {} -> {}",
                        current.enable_discord_presence, new_config.enable_discord_presence
                    );
                }
                if current.check_beta_channel != new_config.check_beta_channel {
                    info!(
                        "Changing beta channel check: {} -> {}",
                        current.check_beta_channel, new_config.check_beta_channel
                    );

                    let mut props = std::collections::HashMap::new();
                    props.insert("enabled".to_string(), serde_json::Value::Bool(new_config.check_beta_channel));
                    crate::commands::analytics_command::track_event("beta_update_toggled", props);
                }
                if current.profile_grouping_criterion != new_config.profile_grouping_criterion {
                    info!(
                        "Changing profile grouping criterion: {:?} -> {:?}",
                        current.profile_grouping_criterion, new_config.profile_grouping_criterion
                    );
                }
                if current.open_logs_after_starting != new_config.open_logs_after_starting {
                    info!(
                        "Changing open logs after starting: {} -> {}",
                        current.open_logs_after_starting, new_config.open_logs_after_starting
                    );
                }
                if current.concurrent_io_limit != new_config.concurrent_io_limit {
                    info!(
                        "Changing concurrent IO limit: {} -> {}",
                        current.concurrent_io_limit, new_config.concurrent_io_limit
                    );
                }
                if current.last_played_profile != new_config.last_played_profile {
                    info!(
                        "Changing last played profile: {:?} -> {:?}",
                        current.last_played_profile, new_config.last_played_profile
                    );
                }
                if current.hooks != new_config.hooks {
                    info!(
                        "Changing hooks: {:?} -> {:?}",
                        current.hooks, new_config.hooks
                    );
                }
                if current.hide_on_process_start != new_config.hide_on_process_start {
                    info!(
                        "Changing hide on process start: {} -> {}",
                        current.hide_on_process_start, new_config.hide_on_process_start
                    );
                }
                if current.global_memory_settings.min != new_config.global_memory_settings.min
                    || current.global_memory_settings.max != new_config.global_memory_settings.max {
                    info!(
                        "Changing global memory settings: {}MB-{}MB -> {}MB-{}MB",
                        current.global_memory_settings.min, current.global_memory_settings.max,
                        new_config.global_memory_settings.min, new_config.global_memory_settings.max
                    );
                }
                if current.global_custom_jvm_args != new_config.global_custom_jvm_args {
                    info!(
                        "Changing global custom JVM args: {:?} -> {:?}",
                        current.global_custom_jvm_args, new_config.global_custom_jvm_args
                    );
                }
                if current.custom_game_directory != new_config.custom_game_directory {
                    info!(
                        "Changing custom game directory: {:?} -> {:?}",
                        current.custom_game_directory, new_config.custom_game_directory
                    );
                }
                if current.enable_analytics != new_config.enable_analytics {
                    info!(
                        "Changing analytics: {} -> {}",
                        current.enable_analytics, new_config.enable_analytics
                    );
                }
                if current.use_browser_based_login != new_config.use_browser_based_login {
                    info!(
                        "Changing use browser based login: {} -> {}",
                        current.use_browser_based_login, new_config.use_browser_based_login
                    );
                }

                // Update config while preserving version
                *config = LauncherConfig {
                    version,
                    is_experimental: new_config.is_experimental,
                    auto_check_updates: new_config.auto_check_updates,
                    concurrent_downloads: new_config.concurrent_downloads,
                    enable_discord_presence: new_config.enable_discord_presence,
                    check_beta_channel: new_config.check_beta_channel,
                    profile_grouping_criterion: new_config.profile_grouping_criterion.clone(),
                    open_logs_after_starting: new_config.open_logs_after_starting,
                    concurrent_io_limit: new_config.concurrent_io_limit,
                    last_played_profile: new_config.last_played_profile,
                    hooks: new_config.hooks,
                    hide_on_process_start: new_config.hide_on_process_start,
                    global_memory_settings: new_config.global_memory_settings,
                    global_custom_jvm_args: new_config.global_custom_jvm_args.clone(),
                    custom_game_directory: new_config.custom_game_directory.clone(),
                    enable_analytics: new_config.enable_analytics,
                    use_browser_based_login: new_config.use_browser_based_login,
                    cache_natives_extraction: new_config.cache_natives_extraction,
                    referral_state: new_config.referral_state.clone(),
                    pack_rollout_override: new_config.pack_rollout_override.clone(),
                    clips: {
                        let mut clips = new_config.clips.clone();
                        clips.normalize();
                        clips
                    },
                };

                true
            }
        };

        // Save the updated config if needed
        if should_save {
            self.save_config().await?;

            // Update cache
            update_custom_game_dir(new_config.custom_game_directory.clone());

            // meta_dir() just moved, so app.db has to move with it — everything else under
            // meta_dir resolves its path per access and follows the change immediately.
            if let Ok(state) = crate::state::State::get().await {
                crate::state::db::open_or_reopen(&state.db).await;
            }

            // Update Discord status if it changed
            if let Ok(state) = crate::state::State::get().await {
                // Check if Discord status changed
                let discord_enabled = new_config.enable_discord_presence;
                if let Err(e) = state.discord_manager.set_enabled(discord_enabled).await {
                    warn!(
                        "Error updating Discord after config change: {}, continuing anyway",
                        e
                    );
                }
            }
        }

        Ok(())
    }
}

#[async_trait]
impl PostInitializationHandler for ConfigManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("ConfigManager: on_state_ready called. Loading configuration...");
        self.load_config_internal().await?;
        info!("ConfigManager: Successfully loaded configuration in on_state_ready.");
        Ok(())
    }
}

pub fn default_config_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(CONFIG_FILENAME)
}

fn differs_ignoring_version(current: &LauncherConfig, next: &LauncherConfig) -> bool {
    let mut candidate = next.clone();
    candidate.version = current.version;
    candidate.clips.normalize();

    let mut baseline = current.clone();
    baseline.clips.normalize();

    baseline != candidate
}

#[cfg(test)]
mod clip_quality_tests {
    use super::*;

    #[test]
    fn presets_resolve_to_the_advertised_numbers() {
        let cases = [
            (QualityPreset::Low, 640, 360, 24, 2_000),
            (QualityPreset::Standard, 1280, 720, 60, 7_000),
            (QualityPreset::High, 1920, 1080, 60, 12_000),
        ];

        for (preset, width, height, fps, bitrate_kbps) in cases {
            let config = ClipConfig {
                quality: Some(preset),
                width: 7,
                height: 7,
                fps: 7,
                bitrate_kbps: 7,
                ..ClipConfig::default()
            };

            assert_eq!(
                config.effective_quality(),
                QualitySpec {
                    width,
                    height,
                    fps,
                    bitrate_kbps
                },
                "{preset:?}"
            );
        }
    }

    #[test]
    fn custom_keeps_the_stored_values() {
        let config = ClipConfig {
            quality: Some(QualityPreset::Custom),
            width: 854,
            height: 480,
            fps: 144,
            bitrate_kbps: 50_000,
            ..ClipConfig::default()
        };

        assert_eq!(
            config.effective_quality(),
            QualitySpec {
                width: 854,
                height: 480,
                fps: 144,
                bitrate_kbps: 50_000
            }
        );
    }

    #[test]
    fn every_offered_custom_value_survives_the_bounds() {
        for (width, height) in CUSTOM_RESOLUTIONS {
            for fps in CUSTOM_FPS {
                for bitrate_kbps in CUSTOM_BITRATES_KBPS {
                    let config = ClipConfig {
                        quality: Some(QualityPreset::Custom),
                        width,
                        height,
                        fps,
                        bitrate_kbps,
                        ..ClipConfig::default()
                    };

                    assert_eq!(
                        config.effective_quality(),
                        QualitySpec {
                            width,
                            height,
                            fps,
                            bitrate_kbps
                        },
                        "{width}x{height} {fps}fps {bitrate_kbps}kbps was altered"
                    );
                }
            }
        }
    }

    #[test]
    fn hand_edited_values_are_brought_into_range() {
        let config = ClipConfig {
            quality: Some(QualityPreset::Custom),
            width: 1921,
            height: 99_999,
            fps: 1,
            bitrate_kbps: 999_999,
            ..ClipConfig::default()
        };

        let quality = config.effective_quality();
        assert_eq!(quality.width, 1920);
        assert_eq!(quality.height, MAX_HEIGHT);
        assert_eq!(quality.fps, MIN_FPS);
        assert_eq!(quality.bitrate_kbps, MAX_BITRATE_KBPS);
        assert_eq!(quality.width % 2, 0);
        assert_eq!(quality.height % 2, 0);
    }

    #[test]
    fn a_config_without_the_new_fields_loads_unchanged() {
        let stored = serde_json::json!({
            "enabled": true,
            "buffer_seconds": 45,
            "width": 1920,
            "height": 1080,
            "fps": 60,
            "bitrate_kbps": 20_000,
            "encoder": "nvenc",
            "capture_audio": true,
        });

        let mut config: ClipConfig = serde_json::from_value(stored).expect("parses");
        assert_eq!(config.quality, None, "the field is absent, not defaulted");
        assert_eq!(config.codec, norisk_ipc::ClipCodec::H264);

        assert_eq!(
            config.effective_quality(),
            QualitySpec {
                width: 1920,
                height: 1080,
                fps: 60,
                bitrate_kbps: 20_000
            },
            "quality changed before normalize"
        );

        config.normalize();
        assert_eq!(config.quality, Some(QualityPreset::Custom));
        assert_eq!(
            config.effective_quality(),
            QualitySpec {
                width: 1920,
                height: 1080,
                fps: 60,
                bitrate_kbps: 20_000
            },
            "quality changed after normalize"
        );
    }

    #[test]
    fn an_unusual_old_config_becomes_custom_without_moving() {
        let mut config = ClipConfig {
            quality: None,
            width: 1600,
            height: 900,
            fps: 30,
            bitrate_kbps: 12_345,
            ..ClipConfig::default()
        };

        config.normalize();
        assert_eq!(config.quality, Some(QualityPreset::Custom));
        assert_eq!(
            config.effective_quality(),
            QualitySpec {
                width: 1600,
                height: 900,
                fps: 30,
                bitrate_kbps: 12_345
            }
        );
    }

    #[test]
    fn normalize_leaves_an_explicit_choice_alone() {
        let mut config = ClipConfig {
            quality: Some(QualityPreset::Custom),
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20_000,
            ..ClipConfig::default()
        };

        config.normalize();
        assert_eq!(config.quality, Some(QualityPreset::Custom));
    }

    #[test]
    fn a_fresh_config_is_internally_consistent() {
        let config = ClipConfig::default();
        let spec = QualityPreset::default().spec().expect("not Custom");

        assert_eq!(config.width, spec.width);
        assert_eq!(config.height, spec.height);
        assert_eq!(config.fps, spec.fps);
        assert_eq!(config.bitrate_kbps, spec.bitrate_kbps);
        assert_eq!(config.effective_quality(), spec);
    }

    #[test]
    fn the_capture_config_carries_the_effective_quality() {
        let config = ClipConfig {
            quality: Some(QualityPreset::Low),
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20_000,
            codec: norisk_ipc::ClipCodec::Av1,
            encoder: "nvenc".to_string(),
            ..ClipConfig::default()
        };

        let capture = config.to_capture_config();
        assert_eq!(capture.width, 640);
        assert_eq!(capture.height, 360);
        assert_eq!(capture.fps, 24);
        assert_eq!(capture.bitrate_kbps, 2_000);
        assert_eq!(capture.codec, norisk_ipc::ClipCodec::Av1);
        assert_eq!(capture.encoder, norisk_ipc::EncoderPreference::Nvenc);
    }

    #[test]
    fn a_low_quality_clip_fits_a_free_discord_upload() {
        let quality = QualityPreset::Low.spec().expect("not Custom");
        let audio_kbps = 160;
        let bytes = (quality.bitrate_kbps + audio_kbps) as u64 * 1000 / 8 * 30;

        assert!(bytes < 10 * 1000 * 1000, "a 30s Low clip is {bytes} bytes");
    }

    #[test]
    fn the_memory_estimate_follows_bitrate_and_duration() {
        let config = ClipConfig {
            quality: Some(QualityPreset::Custom),
            bitrate_kbps: 8_000,
            pre_roll_seconds: 25,
            capture_audio: false,
            ..ClipConfig::default()
        };

        let seconds = 25 + BUFFER_HEADROOM_SECONDS as u64;
        assert_eq!(config.estimated_buffer_bytes(), 8_000 * 1000 / 8 * seconds);

        let with_audio = ClipConfig {
            capture_audio: true,
            ..config.clone()
        };
        assert_eq!(
            with_audio.estimated_buffer_bytes(),
            (8_000 + 160) * 1000 / 8 * seconds
        );

        let high = ClipConfig {
            quality: Some(QualityPreset::High),
            ..config
        };
        assert_eq!(high.estimated_buffer_bytes(), 12_000 * 1000 / 8 * seconds);
    }

    #[test]
    fn the_buffer_always_covers_the_clip_length() {
        for seconds in [MIN_CLIP_SECONDS, 15, 30, 60, MAX_CLIP_SECONDS] {
            let config = ClipConfig {
                pre_roll_seconds: seconds,
                ..ClipConfig::default()
            };

            assert!(
                config.effective_buffer_seconds() > seconds,
                "{seconds}s of clip needs more than {seconds}s of history"
            );
            assert_eq!(
                config.to_capture_config().buffer_seconds,
                config.effective_buffer_seconds()
            );
        }
    }

    #[test]
    fn an_absurd_clip_length_is_brought_into_range() {
        let huge = ClipConfig {
            pre_roll_seconds: 100_000,
            ..ClipConfig::default()
        };
        assert_eq!(
            huge.effective_buffer_seconds(),
            MAX_CLIP_SECONDS + BUFFER_HEADROOM_SECONDS
        );

        let tiny = ClipConfig {
            pre_roll_seconds: 0,
            ..ClipConfig::default()
        };
        assert!(tiny.effective_buffer_seconds() >= MIN_CLIP_SECONDS);
    }

    #[test]
    fn a_config_with_the_old_buffer_field_still_loads() {
        let stored = serde_json::json!({
            "enabled": true,
            "buffer_seconds": 45,
            "quality": "standard",
            "width": 1280,
            "height": 720,
            "fps": 60,
            "bitrate_kbps": 7_000,
            "encoder": "auto",
            "capture_audio": true,
            "pre_roll_seconds": 30,
        });

        let config: ClipConfig = serde_json::from_value(stored).expect("parses");
        assert_eq!(config.pre_roll_seconds, 30);
        assert_eq!(
            config.effective_buffer_seconds(),
            30 + BUFFER_HEADROOM_SECONDS
        );
    }

    #[test]
    fn matching_recognises_each_preset_and_nothing_else() {
        for preset in [
            QualityPreset::Low,
            QualityPreset::Standard,
            QualityPreset::High,
        ] {
            assert_eq!(QualityPreset::matching(preset.spec().unwrap()), preset);
        }

        assert_eq!(
            QualityPreset::matching(QualitySpec {
                width: 1280,
                height: 720,
                fps: 60,
                bitrate_kbps: 6_999,
            }),
            QualityPreset::Custom,
            "one number off is not Standard"
        );
    }

    #[test]
    fn a_changed_clip_setting_counts_as_a_change() {
        let current = LauncherConfig::default();

        let changes: Vec<(&str, Box<dyn Fn(&mut ClipConfig)>)> = vec![
            ("enabled", Box::new(|c: &mut ClipConfig| c.enabled = !c.enabled)),
            ("quality", Box::new(|c: &mut ClipConfig| c.quality = Some(QualityPreset::Low))),
            ("codec", Box::new(|c: &mut ClipConfig| c.codec = norisk_ipc::ClipCodec::Av1)),
            ("encoder", Box::new(|c: &mut ClipConfig| c.encoder = "nvenc".into())),
            ("bitrate", Box::new(|c: &mut ClipConfig| c.bitrate_kbps = 55_000)),
            ("resolution", Box::new(|c: &mut ClipConfig| c.width = 854)),
            ("fps", Box::new(|c: &mut ClipConfig| c.fps = 144)),
            ("clip length", Box::new(|c: &mut ClipConfig| c.pre_roll_seconds = 45)),
            ("audio", Box::new(|c: &mut ClipConfig| c.capture_audio = !c.capture_audio)),
            (
                "audio source",
                Box::new(|c: &mut ClipConfig| c.audio_source = norisk_ipc::AudioSourceChoice::GameOnly),
            ),
            (
                "audio device",
                Box::new(|c: &mut ClipConfig| c.audio_device_id = Some("{some-endpoint}".into())),
            ),
            ("save hotkey", Box::new(|c: &mut ClipConfig| c.hotkey_save = "F9".into())),
            ("toggle hotkey", Box::new(|c: &mut ClipConfig| c.hotkey_toggle = "Ctrl+F9".into())),
            (
                "output folder",
                Box::new(|c: &mut ClipConfig| c.output_dir = Some(PathBuf::from("D:/clips"))),
            ),
        ];

        for (what, change) in changes {
            let mut next = current.clone();
            change(&mut next.clips);
            assert!(
                differs_ignoring_version(&current, &next),
                "changing the {what} setting must be saved"
            );
        }
    }

    #[test]
    fn an_unchanged_config_is_not_rewritten() {
        let current = LauncherConfig::default();
        assert!(!differs_ignoring_version(&current, &current.clone()));
    }

    #[test]
    fn the_version_alone_is_not_a_change() {
        let current = LauncherConfig::default();
        let mut next = current.clone();
        next.version = current.version.wrapping_add(1);

        assert!(!differs_ignoring_version(&current, &next));
    }

    #[test]
    fn an_unnormalised_config_is_not_a_change() {
        let mut current = LauncherConfig::default();
        current.clips.quality = Some(QualityPreset::Standard);

        let mut next = current.clone();
        next.clips.quality = None;

        assert!(
            !differs_ignoring_version(&current, &next),
            "normalising must not look like an edit, or every save would write again"
        );
    }

    #[test]
    fn other_settings_still_count_as_changes() {
        let current = LauncherConfig::default();

        let mut experimental = current.clone();
        experimental.is_experimental = !current.is_experimental;
        assert!(differs_ignoring_version(&current, &experimental));

        let mut memory = current.clone();
        memory.global_memory_settings.max += 1024;
        assert!(differs_ignoring_version(&current, &memory));
    }

    #[test]
    fn the_wire_names_are_stable() {
        for (preset, name) in [
            (QualityPreset::Low, "low"),
            (QualityPreset::Standard, "standard"),
            (QualityPreset::High, "high"),
            (QualityPreset::Custom, "custom"),
        ] {
            assert_eq!(
                serde_json::to_value(preset).unwrap(),
                serde_json::json!(name)
            );
        }
    }
}
