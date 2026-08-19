use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use log::LevelFilter;
use norisk_logging::LogSetup;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "launcher.log";

pub async fn setup_logging() -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = LAUNCHER_DIRECTORY.root_dir().join(LOG_DIR_NAME);

    let setup = LogSetup::new(log_dir, LOG_FILE_NAME)
        .level(LevelFilter::Debug)
        .quiet("sqlx::query", LevelFilter::Warn)
        .quiet("hyper", LevelFilter::Info)
        .quiet("hyper_util", LevelFilter::Info)
        .quiet("reqwest", LevelFilter::Info);

    let log_path = norisk_logging::init(setup)?;

    log::info!(
        "Logging initialized. Log directory: {}",
        log_path.parent().unwrap_or(&log_path).display()
    );

    Ok(())
}
