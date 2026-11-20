use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::forge_install_profile::ForgeInstallProfile;
use crate::minecraft::dto::forge_meta::ForgeVersion;
use async_zip::tokio::read::seek::ZipFileReader;
use log::{info, trace};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;

const LIBRARIES_DIR: &str = "libraries";

pub struct ForgeInstallerDownloadService {
    base_path: PathBuf,
}

impl ForgeInstallerDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(LIBRARIES_DIR);
        Self { base_path }
    }

    pub async fn download_installer(&self, version: &str) -> Result<PathBuf> {
        info!("Downloading Forge installer for version: {}", version);

        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );

        // Zielpfad für die JAR-Datei
        let jar_path = self.base_path.join(&maven_path);

        // Prüfe ob die Datei bereits existiert
        if fs::try_exists(&jar_path).await? {
            info!("Forge installer already exists at: {}", jar_path.display());
            return Ok(jar_path);
        }

        // Erstelle das Verzeichnis falls es nicht existiert
        if let Some(parent) = jar_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Konstruiere die Download-URL
        let url = format!("https://maven.minecraftforge.net/{}", maven_path);

        // Lade die JAR herunter
        trace!("Downloading from: {}", url);
        let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| {
            AppError::Download(format!("Failed to download Forge installer: {}", e))
        })?;

        if !response.status().is_success() {
            return Err(AppError::Download(format!(
                "Failed to download Forge installer: Status {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await.map_err(|e| {
            AppError::Download(format!("Failed to download Forge installer: {}", e))
        })?;

        // Speichere die JAR-Datei
        let mut file = fs::File::create(&jar_path).await?;
        file.write_all(&bytes).await?;
        
        // Ensure the file is fully written to disk before attempting to read it.
        // This prevents potential "end of central directory record not found" errors with jar files
        // that can occur if we try to read the file before the OS has flushed all write buffers.
        file.sync_all().await.map_err(|e| {
            AppError::Download(format!("Failed to sync forge installer: {}", e))
        })?;
        // Explicitly close the file by dropping the handle
        drop(file);

        info!(
            "Successfully downloaded Forge installer to: {}",
            jar_path.display()
        );
        Ok(jar_path)
    }

    /// Reads the installer in one pass. Files already on disk with the right size are kept.
    pub async fn extract_installer(
        &self,
        version: &str,
    ) -> Result<(ForgeVersion, Option<ForgeInstallProfile>)> {
        let jar_path = self.get_installer_path(version);
        let installer_dir = jar_path.parent().unwrap();

        info!("Extracting Forge installer: {}", jar_path.display());

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

        let forge_version: ForgeVersion = match (version_json, &install_profile_json) {
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

        info!("Forge installer extracted ({} files written)", extracted_files);
        Ok((forge_version, install_profile))
    }

    pub fn get_installer_path(&self, version: &str) -> PathBuf {
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        self.base_path.join(&maven_path)
    }

    pub fn get_client_path(&self, version: &str) -> PathBuf {
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-client.jar",
            version, version
        );
        self.base_path.join(&maven_path)
    }
}
