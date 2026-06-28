use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::piston_meta::{DownloadInfo, Library};
use async_zip::tokio::read::seek::ZipFileReader;
use log::{debug, info};
use std::collections::BTreeSet;
use std::io::Cursor;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufReader};

const NATIVES_DIR: &str = "natives";
const NATIVES_HASH_FILE: &str = ".natives_hash";

pub struct MinecraftNativesDownloadService {
    base_path: PathBuf,
}

impl MinecraftNativesDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(NATIVES_DIR);
        Self { base_path }
    }

    /// Computes a deterministic fingerprint from all native library SHA1 hashes.
    /// If any native library changes, this fingerprint will change too.
    fn compute_natives_fingerprint(libraries: &[Library], os: &str, arch: &str) -> String {
        let mut sha1s = BTreeSet::new();

        for library in libraries {
            // Old method: classifiers-based natives
            if let Some(natives) = &library.natives {
                if let Some(classifier) = natives.get(os) {
                    let classifier =
                        classifier.replace("${arch}", if arch == "x86" { "64" } else { arch });
                    if let Some(classifiers) = &library.downloads.classifiers {
                        if let Some(native_info) = classifiers.get(&classifier) {
                            sha1s.insert(native_info.sha1.clone());
                        }
                    }
                }
            }

            // New method: artifact name pattern matching
            let native_patterns = if os == "windows" {
                let mut patterns = vec![];
                if arch == "arm64" {
                    patterns.push(String::from(":natives-windows-arm64"));
                } else if arch == "x86" {
                    patterns.push(String::from(":natives-windows-x86"));
                }
                patterns.push(String::from(":natives-windows"));
                patterns
            } else if os == "osx" {
                let mut patterns = vec![];
                if arch == "aarch64" || arch == "arm64" {
                    patterns.push(String::from(":natives-macos-arm64"));
                }
                patterns.push(String::from(":natives-macos"));
                patterns
            } else {
                vec![format!(":natives-{}", os)]
            };

            for pattern in &native_patterns {
                if library.name.ends_with(pattern) {
                    if let Some(artifact) = &library.downloads.artifact {
                        sha1s.insert(artifact.sha1.clone());
                    }
                }
            }
        }

        sha1s.into_iter().collect::<Vec<_>>().join(",")
    }

    pub async fn extract_natives(&self, libraries: &[Library], version_id: &str, use_cache: bool) -> Result<()> {
        let natives_path = self.base_path.join(version_id);
        let marker_path = natives_path.join(NATIVES_HASH_FILE);

        let os = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "osx"
        } else {
            "linux"
        };

        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x86"
        };

        // Compute fingerprint from all native library SHA1s
        let current_fingerprint = Self::compute_natives_fingerprint(libraries, os, arch);

        // Check if extraction can be skipped (natives already up to date)
        if use_cache && marker_path.exists() {
            if let Ok(marker_content) = fs::read_to_string(&marker_path).await {
                let mut lines = marker_content.lines();
                let stored_fingerprint = lines.next().unwrap_or("");

                if stored_fingerprint == current_fingerprint {
                    // Fingerprint matches — verify all files still exist with correct sizes
                    let mut all_valid = true;
                    for line in lines {
                        if let Some((name, size_str)) = line.split_once(':') {
                            let expected_size: u64 = size_str.parse().unwrap_or(0);
                            let file_path = natives_path.join(name);
                            match fs::metadata(&file_path).await {
                                Ok(meta) if meta.len() == expected_size => {}
                                _ => {
                                    info!("Native file missing or wrong size: {}, re-extracting", name);
                                    all_valid = false;
                                    break;
                                }
                            }
                        }
                    }

                    if all_valid {
                        info!("Natives already up to date for {}, skipping extraction", version_id);
                        return Ok(());
                    }
                } else {
                    info!("Natives fingerprint changed for {}, re-extracting", version_id);
                }
            }
        }

        info!("Extracting natives for {}...", version_id);

        // Clean natives directory if possible
        if natives_path.exists() {
            match fs::remove_dir_all(&natives_path).await {
                Ok(_) => {
                    match fs::create_dir_all(&natives_path).await {
                        Ok(_) => debug!("Created fresh natives directory at {:?}", natives_path),
                        Err(e) => {
                            debug!("Could not create natives directory after deletion: {}. Will try to use existing directory.", e);
                            if !natives_path.exists() {
                                return Err(AppError::Io(e));
                            }
                        }
                    }
                }
                Err(e) => {
                    debug!("Could not clean natives directory: {}. Will try to use existing directory.", e);
                }
            }
        } else {
            match fs::create_dir_all(&natives_path).await {
                Ok(_) => debug!("Created natives directory at {:?}", natives_path),
                Err(e) => {
                    debug!("Could not create natives directory: {}", e);
                    if !natives_path.exists() {
                        return Err(AppError::Io(e));
                    }
                }
            }
        }

        debug!("Looking for natives for OS: {} and arch: {}", os, arch);

        // Track all extracted files with their sizes (last write wins for duplicates)
        let mut extracted_files: std::collections::HashMap<String, u64> = std::collections::HashMap::new();

        // Try old method first
        self.extract_old_natives(libraries, os, arch, &natives_path, &mut extracted_files)
            .await?;

        // Then try new method
        self.extract_new_natives(libraries, os, arch, &natives_path, &mut extracted_files)
            .await?;

        // Write marker file: first line = fingerprint, rest = filename:size
        let mut marker_content = current_fingerprint;
        let mut sorted_files: Vec<_> = extracted_files.into_iter().collect();
        sorted_files.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, size) in &sorted_files {
            marker_content.push('\n');
            marker_content.push_str(&format!("{}:{}", name, size));
        }
        if let Err(e) = fs::write(&marker_path, &marker_content).await {
            debug!("Could not write natives marker file: {}", e);
        }

        info!("Native extraction completed!");
        Ok(())
    }

    async fn extract_old_natives(
        &self,
        libraries: &[Library],
        os: &str,
        arch: &str,
        natives_path: &PathBuf,
        extracted_files: &mut std::collections::HashMap<String, u64>,
    ) -> Result<()> {
        debug!("Starting old natives detection method...");

        for library in libraries {
            if let Some(natives) = &library.natives {
                if let Some(classifier) = natives.get(os) {
                    let classifier =
                        classifier.replace("${arch}", if arch == "x86" { "64" } else { arch });

                    if let Some(classifiers) = &library.downloads.classifiers {
                        if let Some(native_info) = classifiers.get(&classifier) {
                            debug!("Extracting native (old method): {} ({})", library.name, native_info.sha1);
                            self.extract_native_archive(native_info, natives_path, library, extracted_files)
                                .await?;
                        }
                    }
                }
            }
        }

        debug!("Old natives detection completed!");
        Ok(())
    }

    async fn extract_new_natives(
        &self,
        libraries: &[Library],
        os: &str,
        arch: &str,
        natives_path: &PathBuf,
        extracted_files: &mut std::collections::HashMap<String, u64>,
    ) -> Result<()> {
        debug!("Starting new natives detection method...");

        for library in libraries {
            let native_patterns = if os == "windows" {
                let mut patterns = vec![];
                if arch == "arm64" {
                    patterns.push(String::from(":natives-windows-arm64"));
                } else if arch == "x86" {
                    patterns.push(String::from(":natives-windows-x86"));
                }
                patterns.push(String::from(":natives-windows"));
                patterns
            } else if os == "osx" {
                let mut patterns = vec![];
                if arch == "aarch64" || arch == "arm64" {
                    patterns.push(String::from(":natives-macos-arm64"));
                }
                patterns.push(String::from(":natives-macos"));
                patterns
            } else {
                vec![format!(":natives-{}", os)]
            };

            for pattern in &native_patterns {
                if library.name.ends_with(pattern) {
                    if let Some(artifact) = &library.downloads.artifact {
                        debug!("Extracting native (new method): {} ({})", library.name, artifact.sha1);
                        self.extract_native_archive(artifact, natives_path, library, extracted_files)
                            .await?;
                    }
                }
            }
        }

        debug!("New natives detection completed!");
        Ok(())
    }

    async fn extract_native_archive(
        &self,
        native: &DownloadInfo,
        natives_path: &PathBuf,
        library: &Library,
        extracted_files: &mut std::collections::HashMap<String, u64>,
    ) -> Result<()> {
        let target_path = self.get_library_path(native);

        // Read the zip file content
        let file_content = fs::read(&target_path).await?;
        let cursor = Cursor::new(file_content);
        let mut reader = BufReader::new(cursor);

        let mut zip = ZipFileReader::with_tokio(&mut reader)
            .await
            .map_err(|e| AppError::Download(e.to_string()))?;

        // Extract exclude patterns if any
        let exclude_patterns = if let Some(extract) = &library.extract {
            extract.exclude.clone().unwrap_or_default()
        } else {
            Vec::new()
        };

        debug!("    Using exclude patterns: {:?}", exclude_patterns);

        for index in 0..zip.file().entries().len() {
            let file_name = {
                let entry = &zip.file().entries().get(index).unwrap();
                entry
                    .filename()
                    .as_str()
                    .map_err(|e| AppError::Download(e.to_string()))?
                    .to_string()
            };

            // Check if file should be excluded
            let should_exclude = !exclude_patterns.is_empty()
                && exclude_patterns
                    .iter()
                    .any(|pattern| file_name.starts_with(pattern));

            if should_exclude {
                debug!("    Skipping excluded entry: {}", file_name);
                continue;
            }

            let path = natives_path.join(&file_name);
            let entry_is_dir = file_name.ends_with('/');

            if entry_is_dir {
                if !fs::try_exists(&path).await? {
                    match fs::create_dir_all(&path).await {
                        Ok(_) => {}
                        Err(e) => {
                            debug!("    Error creating directory {:?}: {}", path, e);
                        }
                    }
                }
            } else {
                // Create parent directories if they don't exist
                if let Some(parent) = path.parent() {
                    if !fs::try_exists(parent).await? {
                        match fs::create_dir_all(parent).await {
                            Ok(_) => {}
                            Err(e) => {
                                debug!("    Error creating parent directory {:?}: {}", parent, e);
                            }
                        }
                    }
                }

                let mut entry_reader = match zip.reader_with_entry(index).await {
                    Ok(reader) => reader,
                    Err(e) => {
                        debug!("    Error getting reader for entry: {}. Skipping file.", e);
                        continue;
                    }
                };

                // Read the entry content into a buffer
                let mut buffer = Vec::new();
                match entry_reader.read_to_end_checked(&mut buffer).await {
                    Ok(_) => {}
                    Err(e) => {
                        debug!("    Error reading entry content: {}. Skipping file.", e);
                        continue;
                    }
                };

                match fs::File::create(&path).await {
                    Ok(mut writer) => {
                        match writer.write_all(&buffer).await {
                            Ok(_) => {
                                extracted_files.insert(file_name.clone(), buffer.len() as u64);
                                debug!("    Extracted: {}", file_name);
                            }
                            Err(e) => {
                                debug!("    Error writing to file {:?}: {}", path, e);
                            }
                        }
                    }
                    Err(e) => {
                        debug!("    Error creating file {:?}: {}", path, e);
                    }
                };
            }
        }

        Ok(())
    }

    fn get_library_path(&self, download_info: &DownloadInfo) -> PathBuf {
        let url = &download_info.url;
        let path = url
            .split("libraries.minecraft.net/")
            .nth(1)
            .expect("Invalid library URL");

        LAUNCHER_DIRECTORY.meta_dir().join("libraries").join(path)
    }
}
