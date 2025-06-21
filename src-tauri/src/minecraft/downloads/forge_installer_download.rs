use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::forge_install_profile::ForgeInstallProfile;
use crate::minecraft::dto::forge_meta::ForgeVersion;
use async_zip::tokio::read::seek::ZipFileReader;
use log::info;
use reqwest;
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
        info!("Downloading from: {}", url);
        let response = reqwest::get(&url).await.map_err(|e| {
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

    pub async fn extract_version_json(&self, version: &str) -> Result<ForgeVersion> {
        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        let jar_path = self.base_path.join(&maven_path);

        info!(
            "Extracting version information from: {}",
            jar_path.display()
        );

        // Öffne die JAR-Datei
        let mut file = BufReader::new(fs::File::open(jar_path).await?);

        // Öffne die ZIP-Datei
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        // Suche nach version.json oder install_profile.json
        let mut has_version_json = false;
        let mut has_install_profile = false;

        info!("Scanning JAR contents for JSON files...");
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name == "version.json" {
                info!("Found version.json");
                has_version_json = true;
            } else if file_name == "install_profile.json" {
                info!("Found install_profile.json");
                has_install_profile = true;
            }
        }

        info!(
            "Scan results - version.json: {}, install_profile.json: {}",
            has_version_json, has_install_profile
        );

        // Bestimme welche Datei wir lesen sollen
        let (target_file, is_legacy) = if has_version_json {
            ("version.json", false)
        } else if has_install_profile {
            ("install_profile.json", true)
        } else {
            return Err(AppError::Download(
                "Neither version.json nor install_profile.json found in JAR".to_string(),
            ));
        };

        info!("Using {} for version information", target_file);

        // Suche den Index der Ziel-Datei
        let mut target_index = None;
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name == target_file {
                target_index = Some(index);
                break;
            }
        }

        let target_index = target_index
            .ok_or_else(|| AppError::Download(format!("{} not found in JAR", target_file)))?;

        // Lese den Inhalt der Ziel-Datei
        let mut reader = zip.reader_with_entry(target_index).await.map_err(|e| {
            AppError::Download(format!("Failed to read {} entry: {}", target_file, e))
        })?;

        let mut buffer = Vec::new();
        reader.read_to_end_checked(&mut buffer).await.map_err(|e| {
            AppError::Download(format!("Failed to read {} content: {}", target_file, e))
        })?;

        let json_content = String::from_utf8(buffer).map_err(|e| {
            AppError::Download(format!(
                "Failed to convert {} to string: {}",
                target_file, e
            ))
        })?;

        // Deserialisiere den JSON-Inhalt
        let forge_version = if is_legacy {
            info!("Parsing legacy format from install_profile.json");
            // Für legacy Format: Extrahiere versionInfo aus dem install_profile.json
            let json_value: serde_json::Value =
                serde_json::from_str(&json_content).map_err(|e| {
                    AppError::Download(format!("Failed to parse install_profile.json: {}", e))
                })?;

            let version_info = json_value.get("versionInfo").ok_or_else(|| {
                AppError::Download("versionInfo not found in install_profile.json".to_string())
            })?;

            serde_json::from_value(version_info.clone()).map_err(|e| {
                AppError::Download(format!("Failed to parse legacy versionInfo: {}", e))
            })?
        } else {
            info!("Parsing modern format from version.json");
            // Normales Format: Direkt als ForgeVersion parsen
            serde_json::from_str(&json_content)
                .map_err(|e| AppError::Download(format!("Failed to parse version.json: {}", e)))?
        };

        info!("Successfully extracted version information");
        Ok(forge_version)
    }

    pub async fn extract_install_profile(
        &self,
        version: &str,
    ) -> Result<Option<ForgeInstallProfile>> {
        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        let jar_path = self.base_path.join(&maven_path);

        info!(
            "Extracting install_profil.json from: {}",
            jar_path.display()
        );

        // Öffne die JAR-Datei
        let mut file = BufReader::new(fs::File::open(jar_path).await?);

        // Öffne die ZIP-Datei
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        // Suche nach installer.json
        let mut json_content = String::new();
        let mut found = false;

        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name == "install_profile.json" {
                found = true;
                let mut reader = zip.reader_with_entry(index).await.map_err(|e| {
                    AppError::Download(format!("Failed to read install_profile.json entry: {}", e))
                })?;

                reader
                    .read_to_string_checked(&mut json_content)
                    .await
                    .map_err(|e| {
                        AppError::Download(format!(
                            "Failed to read install_profile.json content: {}",
                            e
                        ))
                    })?;
                break;
            }
        }

        if !found {
            info!("No install_profile.json found in JAR");
            return Ok(None);
        }

        // Deserialisiere den JSON-Inhalt
        let install_profile = match serde_json::from_str::<ForgeInstallProfile>(&json_content) {
            Ok(profile) => profile,
            Err(e) => {
                info!("Failed to parse install_profile.json: {}", e);
                return Ok(None);
            }
        };

        info!("Successfully extracted install_profile.json");
        Ok(Some(install_profile))
    }

    pub async fn extract_data_folder(&self, version: &str) -> Result<()> {
        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        let jar_path = self.base_path.join(&maven_path);
        let installer_dir = jar_path.parent().unwrap();

        info!("Extracting data folder from: {}", jar_path.display());
        info!("Installer directory: {}", installer_dir.display());

        // Öffne die JAR-Datei
        let mut file = BufReader::new(fs::File::open(jar_path.clone()).await?);

        // Öffne die ZIP-Datei
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        // Extrahiere alle Dateien im data/ Verzeichnis
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name.starts_with("data/") && !file_name.ends_with('/') {
                info!("\nFound data file: {}", file_name);

                // Behalte den data/ Ordner im Pfad
                let target_path = installer_dir.join(file_name);

                info!("Target path: {}", target_path.display());
                info!(
                    "Parent dir exists: {}",
                    target_path.parent().unwrap().exists()
                );

                // Create parent directories if they don't exist
                if let Some(parent) = target_path.parent() {
                    info!("Creating parent dir: {}", parent.display());
                    fs::create_dir_all(parent).await?;
                }

                let mut reader = zip
                    .reader_with_entry(index)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read entry: {}", e)))?;

                let mut writer = fs::File::create(&target_path).await?;

                // Read the entry content into a buffer
                let mut buffer = Vec::new();
                reader
                    .read_to_end_checked(&mut buffer)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read content: {}", e)))?;

                // Write the content asynchronously
                writer.write_all(&buffer).await?;
                info!("Successfully extracted to: {}", target_path.display());
            }
        }

        info!("Successfully extracted data folder");
        Ok(())
    }

    pub async fn extract_maven_folder(&self, version: &str) -> Result<()> {
        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        let jar_path = self.base_path.join(&maven_path);
        let libraries_dir = &self.base_path; // Direkt den Libraries-Ordner verwenden

        info!("\n🔍 Starting maven folder extraction:");
        info!("📦 Installer JAR: {}", jar_path.display());
        info!("📚 Libraries dir: {}", libraries_dir.display());

        // Öffne die JAR-Datei
        let mut file = BufReader::new(fs::File::open(jar_path.clone()).await?);

        // Öffne die ZIP-Datei
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        info!("\n📂 Contents of installer JAR:");
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;
            info!("  - {}", file_name);
        }

        info!("\n🔄 Extracting maven files:");
        // Extrahiere alle Dateien im maven/ Verzeichnis
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name.starts_with("maven/") && !file_name.ends_with('/') {
                info!("\n📄 Found maven file: {}", file_name);

                // Entferne den maven/ Prefix und behalte den Rest des Pfads
                let relative_path = file_name.trim_start_matches("maven/");
                let target_path = libraries_dir.join(relative_path);

                info!("  📍 Target path: {}", target_path.display());
                info!(
                    "  📂 Parent dir: {}",
                    target_path.parent().unwrap().display()
                );

                // Create parent directories if they don't exist
                if let Some(parent) = target_path.parent() {
                    info!("  📁 Creating parent dir: {}", parent.display());
                    fs::create_dir_all(parent).await?;
                }

                let mut reader = zip
                    .reader_with_entry(index)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read entry: {}", e)))?;

                let mut writer = fs::File::create(&target_path).await?;

                // Read the entry content into a buffer
                let mut buffer = Vec::new();
                reader
                    .read_to_end_checked(&mut buffer)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read content: {}", e)))?;

                // Write the content asynchronously
                writer.write_all(&buffer).await?;
                info!("  ✅ Successfully extracted to: {}", target_path.display());
            }
        }

        info!("\n✨ Maven folder extraction completed!");
        Ok(())
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

    pub async fn extract_jars(&self, version: &str) -> Result<()> {
        // Konstruiere den Maven-Pfad für Forge
        let maven_path = format!(
            "net/minecraftforge/forge/{}/forge-{}-installer.jar",
            version, version
        );
        let jar_path = self.base_path.join(&maven_path);
        let installer_dir = jar_path.parent().unwrap();

        info!("\n🔍 Starting JAR extraction:");
        info!("📦 Installer JAR: {}", jar_path.display());
        info!("📂 Target directory: {}", installer_dir.display());

        // Öffne die JAR-Datei
        let mut file = BufReader::new(fs::File::open(jar_path.clone()).await?);

        // Öffne die ZIP-Datei
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::Download(format!("Failed to read JAR as ZIP: {}", e)))?;

        info!("\n🔄 Extracting JAR files:");
        // Extrahiere alle JAR-Dateien
        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Download(format!("Failed to get filename: {}", e)))?;

            if file_name.ends_with(".jar") {
                info!("\n📄 Found JAR file: {}", file_name);

                // Extrahiere nur den Dateinamen ohne Pfad
                let file_name = file_name.split('/').last().unwrap();
                let target_path = installer_dir.join(file_name);

                info!("  📍 Target path: {}", target_path.display());

                // Create parent directories if they don't exist
                if let Some(parent) = target_path.parent() {
                    info!("  📁 Creating parent dir: {}", parent.display());
                    fs::create_dir_all(parent).await?;
                }

                let mut reader = zip
                    .reader_with_entry(index)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read entry: {}", e)))?;

                let mut writer = fs::File::create(&target_path).await?;

                // Read the entry content into a buffer
                let mut buffer = Vec::new();
                reader
                    .read_to_end_checked(&mut buffer)
                    .await
                    .map_err(|e| AppError::Download(format!("Failed to read content: {}", e)))?;

                // Write the content asynchronously
                writer.write_all(&buffer).await?;
                info!("  ✅ Successfully extracted to: {}", target_path.display());
            }
        }

        info!("\n✨ JAR extraction completed!");
        Ok(())
    }
}
