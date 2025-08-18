use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use log::LevelFilter;
use log4rs::append::console::{ConsoleAppender, Target};
use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
use log4rs::append::rolling_file::policy::compound::trigger::size::SizeTrigger;
use log4rs::append::rolling_file::policy::compound::CompoundPolicy;
use log4rs::append::rolling_file::RollingFileAppender;
use log4rs::config::{Appender, Config, Root};
use log4rs::encode::pattern::PatternEncoder;
use tokio::fs;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "launcher.log";
const LOG_PATTERN: &str = "{d(%Y-%m-%d %H:%M:%S%.3f)} | {({l}):5.5} | {m}{n}";
const CONSOLE_LOG_PATTERN: &str = "{d(%H:%M:%S)} | {h({l}):5.5} | {m}{n}"; // Slightly simpler pattern for console
const LOG_FILE_SIZE_LIMIT_MB: u64 = 10;
const LOG_FILE_BACKUP_COUNT: u32 = 5;

/// Initializes the logging system using log4rs.
/// Configures a rolling file appender and a console appender.
pub async fn setup_logging() -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = LAUNCHER_DIRECTORY.root_dir().join(LOG_DIR_NAME);

    // Ensure the log directory exists
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir).await?;
        // Use log::info! here if possible, but logging might not be fully up yet.
        eprintln!(
            "[Logging Setup] Created log directory: {}",
            log_dir.display()
        );
    }

    let log_file_path = log_dir.join(LOG_FILE_NAME);

    // --- Configure File Rolling Policy ---
    let size_trigger = SizeTrigger::new(LOG_FILE_SIZE_LIMIT_MB * 1024 * 1024);
    let roller_pattern = log_dir.join(format!("{}.{{}}", LOG_FILE_NAME));
    let roller = FixedWindowRoller::builder()
        .base(1)
        .build(roller_pattern.to_str().unwrap(), LOG_FILE_BACKUP_COUNT)?;
    let compound_policy = CompoundPolicy::new(Box::new(size_trigger), Box::new(roller));

    // --- Configure File Appender ---
    let file_appender = RollingFileAppender::builder()
        .encoder(Box::new(PatternEncoder::new(LOG_PATTERN)))
        .build(log_file_path, Box::new(compound_policy))?;

    // --- Configure Console Appender ---
    let console_appender = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(CONSOLE_LOG_PATTERN)))
        .target(Target::Stdout)
        .build();

    // --- Configure log4rs ---
    let config = Config::builder()
        .appender(Appender::builder().build("file", Box::new(file_appender)))
        .appender(Appender::builder().build("stdout", Box::new(console_appender))) // Add console appender
        .build(
            Root::builder()
                .appender("file") // Log to file
                .appender("stdout") // Log to console
                .build(LevelFilter::Debug), // Log Debug and above to both
        )?;

    // Initialize log4rs
    log4rs::init_config(config)?;

    // Now we can use log::info!
    log::info!("Logging initialized. Log directory: {}", log_dir.display());

    Ok(())
}
