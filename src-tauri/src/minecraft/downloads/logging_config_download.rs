use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::piston_meta::LoggingClient;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::info;
use std::path::PathBuf;
use tokio::fs;

const LOGGING_DIR: &str = "assets/log_configs";

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
        Self {
            logging_configs_path,
        }
    }

    pub async fn download_logging_config(&self, logging: &LoggingClient) -> Result<PathBuf> {
        let file_name = logging.file.id.clone();
        let target_path = self.logging_configs_path.join(&file_name);

        info!("[Logging Config Download] Downloading logging config: {}", file_name);

        // Use the new centralized download utility with size verification
        let config = DownloadConfig::new()
            .with_size(logging.file.size as u64)  // Size verification prevents corruption
            .with_streaming(false)  // Config files are small
            .with_retries(3);  // Built-in retry logic

        DownloadUtils::download_file(&logging.file.url, &target_path, config).await?;

        info!("[Logging Config Download] Successfully downloaded logging config to: {}", target_path.display());

        Self::patch_console_to_plain(&target_path).await;

        Ok(target_path)
    }

    pub fn get_jvm_argument(&self, logging_config_path: &PathBuf) -> String {
        format!(
            "-Dlog4j.configurationFile={}",
            logging_config_path.to_string_lossy()
        )
    }

    async fn patch_console_to_plain(config_path: &PathBuf) {
        match fs::read_to_string(config_path).await {
            Ok(content) => {
                let patched = Self::rewrite_console_layout(&content);
                if patched != content {
                    if let Err(e) = fs::write(config_path, &patched).await {
                        log::warn!(
                            "[Logging Config] Could not write patched config {}: {}",
                            config_path.display(),
                            e
                        );
                    } else {
                        info!(
                            "[Logging Config] Patched console appender to plain-text layout: {}",
                            config_path.display()
                        );
                    }
                }
            }
            Err(e) => log::warn!(
                "[Logging Config] Could not read config for patching {}: {}",
                config_path.display(),
                e
            ),
        }
    }

    fn rewrite_console_layout(content: &str) -> String {
        const PATTERN_LAYOUT: &str =
            "<PatternLayout pattern=\"[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n\" />";
        content
            .replace("<LegacyXMLLayout />", PATTERN_LAYOUT)
            .replace("<LegacyXMLLayout/>", PATTERN_LAYOUT)
            .replace("<XMLLayout />", PATTERN_LAYOUT)
            .replace("<XMLLayout/>", PATTERN_LAYOUT)
    }
}
