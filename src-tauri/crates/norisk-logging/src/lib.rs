pub mod redact;

use std::path::PathBuf;

use log::{LevelFilter, Record};
use log4rs::append::console::{ConsoleAppender, Target};
use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
use log4rs::append::rolling_file::policy::compound::trigger::size::SizeTrigger;
use log4rs::append::rolling_file::policy::compound::CompoundPolicy;
use log4rs::append::rolling_file::RollingFileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use log4rs::encode::writer::simple::SimpleWriter;
use log4rs::encode::{Encode, Write};

pub use redact::{mask_identifier, mask_sensitive_data, set_known_accounts};

pub const FILE_PATTERN: &str = "{d(%Y-%m-%d %H:%M:%S%.3f)} | {({l}):5.5} | {m}{n}";
pub const CONSOLE_PATTERN: &str = "{d(%H:%M:%S)} | {h({l}):5.5} | {m}{n}";

pub const DEFAULT_MAX_BYTES: u64 = 4_800_000;
pub const DEFAULT_BACKUPS: u32 = 10;

#[derive(Debug)]
pub struct RedactingEncoder {
    inner: PatternEncoder,
}

impl RedactingEncoder {
    pub fn new(pattern: &str) -> Self {
        Self {
            inner: PatternEncoder::new(pattern),
        }
    }
}

impl Encode for RedactingEncoder {
    fn encode(&self, w: &mut dyn Write, record: &Record) -> anyhow::Result<()> {
        let mut rendered = Vec::new();
        self.inner.encode(&mut SimpleWriter(&mut rendered), record)?;
        let line = String::from_utf8_lossy(&rendered);
        w.write_all(mask_sensitive_data(&line).as_bytes())?;
        Ok(())
    }
}

pub struct LogSetup {
    pub dir: PathBuf,
    pub file_name: String,
    pub max_bytes: u64,
    pub backups: u32,
    pub level: LevelFilter,
    pub quiet_targets: Vec<(String, LevelFilter)>,
    pub console: bool,
}

impl LogSetup {
    pub fn new(dir: impl Into<PathBuf>, file_name: impl Into<String>) -> Self {
        Self {
            dir: dir.into(),
            file_name: file_name.into(),
            max_bytes: DEFAULT_MAX_BYTES,
            backups: DEFAULT_BACKUPS,
            level: LevelFilter::Debug,
            quiet_targets: Vec::new(),
            console: true,
        }
    }

    pub fn level(mut self, level: LevelFilter) -> Self {
        self.level = level;
        self
    }

    pub fn console(mut self, console: bool) -> Self {
        self.console = console;
        self
    }

    pub fn quiet(mut self, target: impl Into<String>, level: LevelFilter) -> Self {
        self.quiet_targets.push((target.into(), level));
        self
    }
}

pub fn init(setup: LogSetup) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(&setup.dir)?;

    let log_path = setup.dir.join(&setup.file_name);

    let size_trigger = SizeTrigger::new(setup.max_bytes);
    let roller_pattern = setup.dir.join(format!("{}.{{}}", setup.file_name));
    let roller = FixedWindowRoller::builder().base(1).build(
        roller_pattern
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("log path is not valid UTF-8: {roller_pattern:?}"))?,
        setup.backups,
    )?;
    let policy = CompoundPolicy::new(Box::new(size_trigger), Box::new(roller));

    let file_appender = RollingFileAppender::builder()
        .encoder(Box::new(RedactingEncoder::new(FILE_PATTERN)))
        .build(&log_path, Box::new(policy))?;

    let mut builder =
        Config::builder().appender(Appender::builder().build("file", Box::new(file_appender)));
    let mut root = Root::builder().appender("file");

    if setup.console {
        let console_appender = ConsoleAppender::builder()
            .encoder(Box::new(RedactingEncoder::new(CONSOLE_PATTERN)))
            .target(Target::Stdout)
            .build();
        builder =
            builder.appender(Appender::builder().build("stdout", Box::new(console_appender)));
        root = root.appender("stdout");
    }

    for (target, level) in &setup.quiet_targets {
        builder = builder.logger(Logger::builder().build(target.clone(), *level));
    }

    let config = builder.build(root.build(setup.level))?;
    log4rs::init_config(config)?;

    Ok(log_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::Level;

    #[test]
    fn encoder_masks_the_rendered_line() {
        let encoder = RedactingEncoder::new(FILE_PATTERN);
        let mut out = Vec::new();
        encoder
            .encode(
                &mut SimpleWriter(&mut out),
                &Record::builder()
                    .level(Level::Info)
                    .args(format_args!(
                        r"Executing command: C:\Users\someone\AppData\javaw.exe --clientId abcdef123"
                    ))
                    .build(),
            )
            .unwrap();

        let line = String::from_utf8(out).unwrap();
        assert!(!line.contains("someone"), "os username leaked: {}", line);
        assert!(line.contains(r"C:\Users\*****\AppData"));
        assert!(line.contains("--clientId *****"));
    }
}
