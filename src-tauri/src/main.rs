// #![feature(exit_status_error)] - wait for feature to be stable
#![cfg_attr(
all(not(debug_assertions), target_os = "windows"),
windows_subsystem = "windows"
)]

use std::fs;

use directories::ProjectDirs;
use log::{debug, info, LevelFilter};
use log4rs::{
    append::{
        console::{ConsoleAppender, Target},
        rolling_file::policy::compound::{
            CompoundPolicy, roll::fixed_window::FixedWindowRoller, trigger::size::SizeTrigger,
        },
    },
    config::{Appender, Config, Root},
    encode::pattern::PatternEncoder,
};
use once_cell::sync::Lazy;
use reqwest::Client;
use crate::minecraft::minecraft_auth::MinecraftAuthStore;

pub mod app;
pub mod minecraft;
pub mod custom_servers;

mod error;
mod utils;

const LAUNCHER_VERSION: &str = env!("CARGO_PKG_VERSION");
static LAUNCHER_DIRECTORY: Lazy<ProjectDirs> = Lazy::new(|| {
    match ProjectDirs::from("gg", "norisk", "NoRiskClient") {
        Some(proj_dirs) => proj_dirs,
        None => panic!("no application directory")
    }
});

static APP_USER_AGENT: &str = concat!(
env!("CARGO_PKG_NAME"),
"/",
env!("CARGO_PKG_VERSION"),
);

/// HTTP Client with launcher agent
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    let client = reqwest::ClientBuilder::new()
        .user_agent(APP_USER_AGENT)
        .build()
        .unwrap_or_else(|_| Client::new());

    client
});

const TRIGGER_FILE_SIZE: u64 = 2 * 1024 * 1000;

/// Number of archive log files to keep
const LOG_FILE_COUNT: u32 = 10;

pub fn main() -> anyhow::Result<()> {
    let log_folder = LAUNCHER_DIRECTORY.data_dir().join("logs");
    let latest_log = log_folder.join("latest.log");
    let archive_folder = log_folder.join("archive").join("launcher.{}.log");

    // Build a stdout logger.
    let stderr = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new("[{d(%d-%m-%Y %H:%M:%S)}] {l} - {m}\n")))
        .target(Target::Stderr).build();

    // Create a policy to use with the file logging
    let trigger = SizeTrigger::new(TRIGGER_FILE_SIZE);
    let roller = FixedWindowRoller::builder()
        .base(0) // Default Value (line not needed unless you want to change from 0 (only here for demo purposes)
        .build(archive_folder.to_str().unwrap(), LOG_FILE_COUNT) // Roll based on pattern and max 3 archive files
        .unwrap();
    let policy = CompoundPolicy::new(Box::new(trigger), Box::new(roller));

    // Logging to log file. (with rolling)
    let logfile = log4rs::append::rolling_file::RollingFileAppender::builder()
        // Pattern: https://docs.rs/log4rs/*/log4rs/encode/pattern/index.html
        .encoder(Box::new(PatternEncoder::new("[{d(%d-%m-%Y %H:%M:%S)}] {l} - {m}\n")))
        .build(latest_log.clone(), Box::new(policy))
        .unwrap();

    //TODO log also in console
    // Log Trace level output to file where trace is the default level
    // and the programmatically specified level to stderr.
    let config = Config::builder()
        .appender(Appender::builder().build("logfile", Box::new(logfile)))
        .appender(
            Appender::builder()
                //.filter(Box::new(ThresholdFilter::new(LevelFilter::Trace)))
                .build("stderr", Box::new(stderr)),
        )
        .build(
            Root::builder()
                .appender("logfile")
                .appender("stderr")
                .build(LevelFilter::Trace),
        )
        .unwrap();

    // Use this to change log levels at runtime.
    // This means you can change the default log level to trace
    // if you are trying to debug an issue and need more logs on then turn it off
    // once you are done.
    let _handle = log4rs::init_config(config)?;

    info!("###############################");
    info!("");
    info!("");
    info!("      NEW LAUNCHER LOG");
    info!("");
    info!("");
    info!("###############################");


    // application directory
    info!("Creating launcher directories...");
    fs::create_dir_all(LAUNCHER_DIRECTORY.data_dir())?;
    fs::create_dir_all(LAUNCHER_DIRECTORY.config_dir())?;

    // app
    app::gui::gui_main();

    Ok(())
}
