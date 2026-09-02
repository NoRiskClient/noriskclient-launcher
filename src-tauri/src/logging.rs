use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use log::LevelFilter;
use norisk_logging::LogSetup;

pub use norisk_logging::{RedactingEncoder, FILE_PATTERN as LOG_PATTERN};

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "launcher.log";

pub const DEFAULT_LOG_LEVEL: LevelFilter = LevelFilter::Debug;

pub fn env_log_level() -> Option<LevelFilter> {
    std::env::var("NRC_LOG_LEVEL")
        .ok()
        .and_then(|value| value.trim().parse::<LevelFilter>().ok())
}

pub fn current_log_level() -> LevelFilter {
    norisk_logging::current_level()
}

pub async fn setup_logging() -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = LAUNCHER_DIRECTORY.root_dir().join(LOG_DIR_NAME);
    let from_env = env_log_level();
    let root_level = from_env.unwrap_or(DEFAULT_LOG_LEVEL);

    let setup = LogSetup::new(log_dir, LOG_FILE_NAME)
        .level(root_level)
        .quiet("sqlx::query", LevelFilter::Warn)
        .quiet("hyper", LevelFilter::Info)
        .quiet("hyper_util", LevelFilter::Info)
        .quiet("reqwest", LevelFilter::Info);

    let log_path = norisk_logging::init(setup)?;

    log::info!(
        "Logging initialized (level: {}{}). Log directory: {}",
        root_level,
        if from_env.is_some() {
            ", from NRC_LOG_LEVEL"
        } else {
            ""
        },
        log_path.parent().unwrap_or(&log_path).display()
    );

    Ok(())
}

pub fn set_log_level(level: LevelFilter) {
    let was = current_log_level();
    match norisk_logging::set_level(level) {
        Ok(()) if was != level => log::info!("Log level changed: {} -> {}", was, level),
        Ok(()) => {}
        Err(e) => log::error!("Failed to rebuild logging config for level {}: {}", level, e),
    }
}
