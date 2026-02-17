use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use chrono::Utc;
use log::LevelFilter;
use log4rs::append::console::{ConsoleAppender, Target};
use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
use log4rs::append::rolling_file::policy::compound::trigger::size::SizeTrigger;
use log4rs::append::rolling_file::policy::compound::CompoundPolicy;
use log4rs::append::rolling_file::RollingFileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::writer::simple::SimpleWriter;
use log4rs::encode::Encode;
use log4rs::encode::pattern::PatternEncoder;
use log4rs::filter::threshold::ThresholdFilter;
use once_cell::sync::Lazy;
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use tokio::fs;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "launcher.log";
const DEBUG_DUMP_FILE_PREFIX: &str = "launcher-debug";
const LOG_PATTERN: &str = "{d(%Y-%m-%d %H:%M:%S%.3f)} | {({l}):5.5} | {m}{n}";
const CONSOLE_LOG_PATTERN: &str = "{d(%H:%M:%S)} | {h({l}):5.5} | {m}{n}"; // Slightly simpler pattern for console
const LOG_FILE_SIZE_LIMIT_BYTES: u64 = 4_800_000; // ~4.8MB to fit Discord's 8MB upload limit
const LOG_FILE_BACKUP_COUNT: u32 = 10;
const DEBUG_RING_BUFFER_MAX_BYTES: usize = LOG_FILE_SIZE_LIMIT_BYTES as usize;

#[derive(Debug, Default)]
struct DebugRingBufferState {
    lines: VecDeque<String>,
    bytes: usize,
}

static DEBUG_RING_BUFFER: Lazy<Mutex<DebugRingBufferState>> =
    Lazy::new(|| Mutex::new(DebugRingBufferState::default()));

#[derive(Debug)]
struct DebugRingBufferAppender {
    encoder: Box<dyn Encode>,
}

impl DebugRingBufferAppender {
    fn new() -> Self {
        Self {
            encoder: Box::new(PatternEncoder::new(LOG_PATTERN)),
        }
    }

    fn push_line(&self, line: String) {
        if let Ok(mut state) = DEBUG_RING_BUFFER.lock() {
            let line_bytes = line.as_bytes().len();

            while state.bytes + line_bytes > DEBUG_RING_BUFFER_MAX_BYTES {
                match state.lines.pop_front() {
                    Some(removed) => {
                        state.bytes = state.bytes.saturating_sub(removed.as_bytes().len());
                    }
                    None => break,
                }
            }

            state.bytes += line_bytes;
            state.lines.push_back(line);
        }
    }
}

impl log::Log for DebugRingBufferAppender {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let mut encoded = Vec::new();
        {
            let mut writer = SimpleWriter(&mut encoded);
            if let Err(e) = self.encoder.encode(&mut writer, record) {
                eprintln!("[Logging] Failed to encode debug ring buffer line: {}", e);
                return;
            }
        }

        self.push_line(String::from_utf8_lossy(&encoded).into_owned());

        if record.level() == log::Level::Error {
            let reason = format!("error: {}", record.args());
            if let Err(e) = dump_debug_buffer_to_file(&reason) {
                eprintln!("[Logging] Failed to dump debug ring buffer on error: {}", e);
            }
        }
    }

    fn flush(&self) {}
}

pub fn dump_debug_buffer_to_file(
    reason: &str,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let log_dir = LAUNCHER_DIRECTORY.root_dir().join(LOG_DIR_NAME);
    std::fs::create_dir_all(&log_dir)?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S%.3f");
    let dump_file_path = log_dir.join(format!("{}-{}.log", DEBUG_DUMP_FILE_PREFIX, timestamp));

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&dump_file_path)?;

    writeln!(file, "# NoRisk Launcher Debug Buffer Dump")?;
    writeln!(file, "# Timestamp (UTC): {}", Utc::now().to_rfc3339())?;
    writeln!(file, "# Reason: {}", reason)?;
    let (current_buffer_len, current_buffer_bytes) = DEBUG_RING_BUFFER
        .lock()
        .map(|state| (state.lines.len(), state.bytes))
        .unwrap_or((0, 0));
    writeln!(
        file,
        "# Buffered Lines: {}",
        current_buffer_len,
    )?;
    writeln!(
        file,
        "# Buffered Bytes: {} (max {})",
        current_buffer_bytes,
        DEBUG_RING_BUFFER_MAX_BYTES
    )?;
    writeln!(file)?;

    if let Ok(state) = DEBUG_RING_BUFFER.lock() {
        for line in state.lines.iter() {
            file.write_all(line.as_bytes())?;
        }
    }

    Ok(dump_file_path)
}

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
    let size_trigger = SizeTrigger::new(LOG_FILE_SIZE_LIMIT_BYTES);
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

    // --- Configure In-Memory Debug Ring Buffer Appender ---
    let debug_ring_buffer_appender = DebugRingBufferAppender::new();

    // --- Configure log4rs ---
    let config = Config::builder()
        .appender(
            Appender::builder()
                .filter(Box::new(ThresholdFilter::new(LevelFilter::Info)))
                .build("file", Box::new(file_appender)),
        )
        .appender(Appender::builder().build("stdout", Box::new(console_appender))) // Add console appender
        .appender(
            Appender::builder()
                .build("debug_ring_buffer", Box::new(debug_ring_buffer_appender)),
        )
        // Suppress noisy event-loop warnings from window focus/tab-in transitions.
        .logger(Logger::builder().build("winit", LevelFilter::Error)) // prevent winit from logging at all levels (WARN on window focus)
        .logger(Logger::builder().build("tao", LevelFilter::Error)) // prevent tao from logging at all levels (WARN on window focus)
        .build(
            Root::builder()
                .appender("file") // Log to file
                .appender("stdout") // Log to console
                .appender("debug_ring_buffer") // Keep debug lines in RAM for crash/error dumps
                .build(LevelFilter::Debug),
        )?;

    // Initialize log4rs
    log4rs::init_config(config)?;

    // Now we can use log::info!
    log::debug!("Logging initialized. Log directory: {}", log_dir.display());

    Ok(())
}
