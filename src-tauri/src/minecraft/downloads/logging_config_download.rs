use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::piston_meta::LoggingClient;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use crate::utils::file_utils::write_atomic;
use log::{info, warn};
use std::path::{Path, PathBuf};
use tokio::fs;

const LOGGING_DIR: &str = "assets/log_configs";
const PATCHED_PREFIX: &str = "nrc-";
const PATTERN_LAYOUT: &str =
    "<PatternLayout pattern=\"[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n\" />";

pub struct MinecraftLoggingDownloadService {
    logging_configs_path: PathBuf,
}

impl MinecraftLoggingDownloadService {
    pub fn new() -> Self {
        let logging_configs_path = LAUNCHER_DIRECTORY.meta_dir().join(LOGGING_DIR);
        info!(
            "[Logging Config Service] Initialized. Config Path: {}",
            logging_configs_path.display()
        );
        Self::with_path(logging_configs_path)
    }

    pub fn with_path(logging_configs_path: PathBuf) -> Self {
        Self {
            logging_configs_path,
        }
    }

    pub async fn download_logging_config(&self, logging: &LoggingClient) -> Result<PathBuf> {
        let file_name = logging.file.id.clone();
        let vanilla_path = self.logging_configs_path.join(&file_name);
        let patched_path = self
            .logging_configs_path
            .join(format!("{}{}", PATCHED_PREFIX, file_name));

        let config = DownloadConfig::new()
            .with_sha1(logging.file.sha1.clone())
            .with_size(logging.file.size as u64)
            .with_streaming(false)
            .with_retries(3);

        match DownloadUtils::download_file(&logging.file.url, &vanilla_path, config).await {
            Ok(()) => {
                info!(
                    "[Logging Config] Verified logging config: {}",
                    vanilla_path.display()
                );
                Self::write_patched(&vanilla_path, &patched_path).await?;
                Ok(patched_path)
            }
            Err(e) if fs::try_exists(&patched_path).await.unwrap_or(false) => {
                warn!(
                    "[Logging Config] {} unreachable ({}); using cached {}",
                    logging.file.url,
                    e,
                    patched_path.display()
                );
                Ok(patched_path)
            }
            Err(e) => Err(e),
        }
    }

    pub fn get_jvm_argument(&self, logging_config_path: &PathBuf) -> String {
        format!(
            "-Dlog4j.configurationFile={}",
            logging_config_path.to_string_lossy()
        )
    }

    async fn write_patched(source: &Path, target: &Path) -> Result<()> {
        let content = fs::read_to_string(source).await?;
        let patched = Self::rewrite_console_layout(&content);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).await?;
        }
        if fs::read_to_string(target).await.ok().as_deref() == Some(patched.as_str()) {
            return Ok(());
        }
        write_atomic(target, patched.as_bytes()).await?;
        info!(
            "[Logging Config] Wrote plain-text console config: {}",
            target.display()
        );
        Ok(())
    }

    fn rewrite_console_layout(content: &str) -> String {
        content
            .replace("<LegacyXMLLayout />", PATTERN_LAYOUT)
            .replace("<LegacyXMLLayout/>", PATTERN_LAYOUT)
            .replace("<XMLLayout />", PATTERN_LAYOUT)
            .replace("<XMLLayout/>", PATTERN_LAYOUT)
    }
}

#[cfg(test)]
#[path = "logging_config_download_test.rs"]
mod tests;
