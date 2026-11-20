use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::neo_forge_install_profile::NeoForgeInstallProfile;
use crate::minecraft::dto::neo_forge_meta::NeoForgeVersion;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use async_zip::tokio::read::seek::ZipFileReader;
use log::{info, trace};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::BufReader;

const LIBRARIES_DIR: &str = "libraries";

pub struct NeoForgeInstallerDownloadService {
    base_path: PathBuf,
}

impl NeoForgeInstallerDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(LIBRARIES_DIR);
        Self { base_path }
    }

    pub async fn download_installer(&self, version: &str) -> Result<PathBuf> {
        info!("Downloading NeoForge installer for version: {}", version);

        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
            version, version
        );

        // Zielpfad für die JAR-Datei
        let jar_path = self.base_path.join(&maven_path);

        // Konstruiere die Download-URL
        let url = format!("https://maven.neoforged.net/releases/{}", maven_path);

        trace!("Downloading from: {}", url);

        // Use the new centralized download utility
        let config = DownloadConfig::new()
            .with_streaming(true)  // Installer JARs can be large
            .with_retries(3)  // Built-in retry logic for network issues
            .with_force_overwrite(false);  // Check if file exists

        DownloadUtils::download_file(&url, &jar_path, config).await?;

        info!("Successfully downloaded NeoForge installer to: {}", jar_path.display());
        Ok(jar_path)
    }

    /// Reads the installer in one pass. Files already on disk with the right size are kept.
    pub async fn extract_installer(
        &self,
        version: &str,
    ) -> Result<(NeoForgeVersion, Option<NeoForgeInstallProfile>)> {
        let jar_path = self.get_installer_path(version);
        let installer_dir = jar_path.parent().unwrap();

        info!("Extracting NeoForge installer: {}", jar_path.display());

        let mut file = BufReader::new(fs::File::open(&jar_path).await?);
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        let mut version_json = None;
        let mut install_profile_json = None;
        let mut extracted_files = 0usize;

        for index in 0..zip.file().entries().len() {
            let entry = zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?
                .to_string();
            let size = entry.uncompressed_size();

            let mut targets = Vec::new();
            if !file_name.ends_with('/') {
                if file_name.starts_with("data/") {
                    targets.push(installer_dir.join(&file_name));
                }
                if let Some(relative_path) = file_name.strip_prefix("maven/") {
                    targets.push(self.base_path.join(relative_path));
                }
            }
            if file_name.ends_with(".jar") {
                let flat = installer_dir.join(file_name.rsplit('/').next().unwrap());
                if !targets.contains(&flat) {
                    targets.push(flat);
                }
            }

            let mut missing = Vec::new();
            for target in targets {
                if fs::metadata(&target).await.map_or(true, |m| m.len() != size) {
                    missing.push(target);
                }
            }

            let is_json = file_name == "version.json" || file_name == "install_profile.json";
            if !is_json && missing.is_empty() {
                continue;
            }

            let mut buffer = Vec::new();
            zip.reader_with_entry(index)
                .await
                .map_err(|e| AppError::Download(format!("Failed to read entry {}: {}", file_name, e)))?
                .read_to_end_checked(&mut buffer)
                .await
                .map_err(|e| AppError::Download(format!("Failed to read {}: {}", file_name, e)))?;

            match file_name.as_str() {
                "version.json" => version_json = Some(buffer),
                "install_profile.json" => install_profile_json = Some(buffer),
                _ => {
                    for target in missing {
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent).await?;
                        }
                        fs::write(&target, &buffer).await?;
                        trace!("Extracted {} to {}", file_name, target.display());
                        extracted_files += 1;
                    }
                }
            }
        }

        let neoforge_version: NeoForgeVersion = match (version_json, &install_profile_json) {
            (Some(json), _) => serde_json::from_slice(&json)
                .map_err(|e| AppError::Download(format!("Failed to parse version.json: {}", e)))?,
            // Legacy installers carry the version JSON as `versionInfo` inside the install profile.
            (None, Some(json)) => {
                let mut profile: serde_json::Value = serde_json::from_slice(json).map_err(|e| {
                    AppError::Download(format!("Failed to parse install_profile.json: {}", e))
                })?;
                let version_info = profile
                    .get_mut("versionInfo")
                    .map(serde_json::Value::take)
                    .ok_or_else(|| {
                        AppError::Download("versionInfo not found in install_profile.json".to_string())
                    })?;
                serde_json::from_value(version_info).map_err(|e| {
                    AppError::Download(format!("Failed to parse legacy versionInfo: {}", e))
                })?
            }
            (None, None) => {
                return Err(AppError::Download(
                    "Neither version.json nor install_profile.json found in JAR".to_string(),
                ))
            }
        };

        let install_profile = install_profile_json.and_then(|json| {
            serde_json::from_slice(&json)
                .map_err(|e| info!("Failed to parse install_profile.json: {}", e))
                .ok()
        });

        info!("NeoForge installer extracted ({} files written)", extracted_files);
        Ok((neoforge_version, install_profile))
    }

    pub fn get_installer_path(&self, version: &str) -> PathBuf {
        let maven_path = format!(
            "net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
            version, version
        );
        self.base_path.join(&maven_path)
    }

    pub fn get_client_path(&self, version: &str) -> PathBuf {
        let maven_path = format!(
            "net/neoforged/neoforge/{}/neoforge-{}-client.jar",
            version, version
        );
        self.base_path.join(&maven_path)
    }
}
