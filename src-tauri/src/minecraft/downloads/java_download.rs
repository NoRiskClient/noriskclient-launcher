use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::{JavaDistribution, ZuluApiResponse};
use crate::state::State;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use crate::utils::system_info::{Architecture, OperatingSystem, ARCHITECTURE, OS};
use async_zip::tokio::read::seek::ZipFileReader;
use flate2::read::GzDecoder;
use futures::future::try_join_all;
use log::{debug, error, info};
use reqwest;
use std::fs::File;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tar::Archive;
use tokio::fs;
use tokio::io::BufReader;
use tokio_util::compat::FuturesAsyncReadCompatExt;

const JAVA_DIR: &str = "java";
const DEFAULT_CONCURRENT_EXTRACTIONS: usize = 4;

// Legacy Java component that requires x86_64 Java on ARM64 Macs
const LEGACY_JAVA_COMPONENT: &str = "jre-legacy";

pub struct JavaDownloadService {
    base_path: PathBuf,
    concurrent_extractions: usize,
}

impl JavaDownloadService {
    pub fn new() -> Self {
        let base_path = crate::config::standard_meta_dir().join(JAVA_DIR);
        Self {
            base_path,
            concurrent_extractions: DEFAULT_CONCURRENT_EXTRACTIONS,
        }
    }

    // Check if we need to use x86_64 Java based on the Java component
    pub fn needs_x86_64_java(&self, java_component: Option<&str>) -> bool {
        // Only needed on Apple Silicon Macs
        if !cfg!(target_os = "macos") || ARCHITECTURE != Architecture::AARCH64 {
            return false;
        }

        // Check if this is a legacy Java component
        match java_component {
            Some(component) if component == LEGACY_JAVA_COMPONENT => {
                info!("⚠️ Legacy Java component '{}' detected on Apple Silicon. Will use x86_64 Java for compatibility.", component);
                true
            }
            _ => false,
        }
    }

    pub async fn get_or_download_java(
        &self,
        version: u32,
        distribution: &JavaDistribution,
        java_component: Option<&str>,
    ) -> Result<PathBuf> {
        info!("Checking Java version: {}", version);

        // Handle architecture override for legacy Java component on ARM64 Mac
        let force_x86_64 = self.needs_x86_64_java(java_component);

        // Check if Java is already downloaded
        if let Ok(java_binary) = self
            .find_java_binary(distribution, &version, force_x86_64)
            .await
        {
            info!("Found existing Java installation at: {:?}", java_binary);
            return Ok(java_binary);
        }

        // Download and setup Java
        info!("Downloading Java {}...", version);
        self.download_java(version, distribution, force_x86_64)
            .await?;

        // Find and return Java binary
        self.find_java_binary(distribution, &version, force_x86_64)
            .await
    }

    pub async fn download_java(
        &self,
        version: u32,
        distribution: &JavaDistribution,
        force_x86_64: bool,
    ) -> Result<PathBuf> {
        let arch_suffix = if force_x86_64 { "_x86_64" } else { "" };
        info!(
            "Downloading Java {} for distribution: {}{}",
            version,
            distribution.get_name(),
            arch_suffix
        );

        // Get the initial URL
        let initial_url = distribution.get_url(&version, force_x86_64)?;
        info!("Java Download URL: {}", initial_url);

        // For Zulu, we need to make an extra API call to get the actual download URL
        let download_url = if distribution.requires_api_response() {
            info!("Fetching actual download URL from Zulu API...");
            let client = reqwest::Client::new();
            let response = client
                .get(&initial_url)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|e| AppError::JavaDownload(format!("Failed to fetch Zulu API: {}", e)))?;

            if !response.status().is_success() {
                return Err(AppError::JavaDownload(format!(
                    "Zulu API returned error status: {}",
                    response.status()
                )));
            }

            // Parse the JSON response
            let zulu_response: ZuluApiResponse = response.json().await.map_err(|e| {
                AppError::JavaDownload(format!("Failed to parse Zulu API response: {}", e))
            })?;

            info!("Actual download URL: {}", zulu_response.url);
            zulu_response.url
        } else {
            initial_url
        };

        // Create version-specific directory with architecture suffix for legacy support
        let dir_name = format!(
            "{}_{}{}",
            distribution.get_name(),
            version,
            if force_x86_64 { "_x86_64" } else { "" }
        );
        let version_dir = self.base_path.join(dir_name);
        fs::create_dir_all(&version_dir).await?;

        // Save the downloaded file
        let archive_path = version_dir.join(format!("java.{}", OS.get_archive_type()?));

        // Download Java archive using the centralized utility (fixes issue #1203)
        let config = DownloadConfig::new()
            .with_streaming(true)  // Java archives are large files
            .with_retries(3)  // Built-in retry logic for network issues
            .with_force_overwrite(true);  // Always download fresh Java

        DownloadUtils::download_file(&download_url, &archive_path, config)
            .await
            .map_err(|e| AppError::JavaDownload(format!("Failed to download Java archive: {}", e)))?;

        // Extract the archive
        self.extract_java_archive(&archive_path, &version_dir)
            .await?;

        // Clean up the archive
        fs::remove_file(&archive_path).await?;

        Ok(version_dir)
    }

    async fn extract_java_archive(
        &self,
        archive_path: &PathBuf,
        target_dir: &PathBuf,
    ) -> Result<()> {
        info!(
            "Extracting Java archive: {:?} to {:?}",
            archive_path, target_dir
        );

        match OS {
            OperatingSystem::WINDOWS => {
                let state = State::get().await?;
                let io_semaphore = state.io_semaphore.clone();

                // Initial open for listing entries and determining root_dir
                let file_for_listing = tokio::fs::File::open(archive_path).await.map_err(|e| {
                    error!(
                        "Failed to open Java ZIP for listing {:?}: {}",
                        archive_path, e
                    );
                    AppError::JavaDownload(format!("ZIP Open error for listing: {}", e))
                })?;
                let mut buf_reader_listing = BufReader::new(file_for_listing);
                let mut zip_lister = ZipFileReader::with_tokio(&mut buf_reader_listing)
                    .await
                    .map_err(|e| {
                        error!("Failed to read Java ZIP for listing: {}", e);
                        AppError::JavaDownload(format!("ZIP Read error for listing: {}", e))
                    })?;

                let entries_meta = zip_lister
                    .file()
                    .entries()
                    .iter()
                    .enumerate()
                    .map(|(idx, e)| {
                        let filename = e.filename().as_str().unwrap_or("").to_string();
                        let is_dir = e.dir().unwrap_or(false);
                        let uncompressed_size = e.uncompressed_size();
                        (idx, filename, is_dir, uncompressed_size)
                    })
                    .collect::<Vec<_>>();

                // Determine the common root directory from the collected metadata
                let mut root_dir_prefix: Option<String> = None;
                for (_, path_str, is_dir, _) in &entries_meta {
                    if *is_dir && path_str.chars().filter(|&c| c == '/').count() == 1 {
                        root_dir_prefix = Some(path_str.clone());
                        debug!(
                            "Detected Java archive root directory: {:?}",
                            root_dir_prefix
                        );
                        break;
                    }
                }
                // Drop the lister and its file handle, we have the metadata needed.
                drop(zip_lister);
                drop(buf_reader_listing);

                let mut extraction_tasks = Vec::new();

                for (original_entry_index, full_path_str, is_entry_dir, entry_size) in entries_meta
                {
                    // Calculate the path relative to target_dir, stripping the root_dir_prefix if present
                    let relative_path_str = if let Some(ref root) = root_dir_prefix {
                        if full_path_str.starts_with(root) && full_path_str != *root {
                            full_path_str[root.len()..].to_string()
                        } else if full_path_str == *root {
                            continue; // Skip the root directory entry itself
                        } else {
                            full_path_str.to_string() // Should not happen if root_dir_prefix is determined correctly
                        }
                    } else {
                        full_path_str.to_string()
                    };

                    if relative_path_str.is_empty() {
                        continue;
                    }

                    let final_dest_path = target_dir.join(relative_path_str);

                    let task_archive_path = archive_path.clone();
                    let task_io_semaphore = io_semaphore.clone();
                    let task_final_dest_path = final_dest_path.clone();
                    // original_entry_index is already defined from the loop

                    if is_entry_dir {
                        extraction_tasks.push(tokio::spawn(async move {
                            let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                                error!(
                                    "Java Task: Failed to acquire semaphore for dir {}: {}",
                                    task_final_dest_path.display(),
                                    e
                                );
                                AppError::JavaDownload(format!(
                                    "Semaphore error for dir {}: {}",
                                    task_final_dest_path.display(),
                                    e
                                ))
                            })?;
                            if !task_final_dest_path.exists() {
                                debug!("Java Task: Creating directory: {:?}", task_final_dest_path);
                                fs::create_dir_all(&task_final_dest_path)
                                    .await
                                    .map_err(|e| {
                                        error!(
                                            "Java Task: Failed to create dir {:?}: {}",
                                            task_final_dest_path, e
                                        );
                                        AppError::JavaDownload(format!("Create dir error: {}", e))
                                    })?;
                            }
                            Ok::<(), AppError>(())
                        }));
                    } else {
                        info!(
                            "Java Task: Queueing concurrent streaming for '{}' -> {:?} (Size: {} bytes)",
                            full_path_str, task_final_dest_path, entry_size
                        );
                        extraction_tasks.push(tokio::spawn(async move {
                            let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                                error!(
                                    "Java Task: Failed to acquire semaphore for '{}': {}",
                                    task_final_dest_path.display(),
                                    e
                                );
                                AppError::JavaDownload(format!(
                                    "Semaphore error for '{}': {}",
                                    task_final_dest_path.display(),
                                    e
                                ))
                            })?;

                            if let Some(parent) = task_final_dest_path.parent() {
                                if !parent.exists() {
                                    fs::create_dir_all(parent).await.map_err(|e| {
                                        error!(
                                            "Java Task: Failed to create parent for '{}': {}",
                                            task_final_dest_path.display(),
                                            e
                                        );
                                        AppError::JavaDownload(format!(
                                            "Create parent error: {}",
                                            e
                                        ))
                                    })?;
                                }
                            }

                            let task_file = tokio::fs::File::open(&task_archive_path)
                                .await
                                .map_err(|e| {
                                    error!(
                                        "Java Task: Failed to open archive {:?}: {}",
                                        task_archive_path, e
                                    );
                                    AppError::JavaDownload(format!("ZIP Open error in task: {}", e))
                                })?;
                            let mut task_buf_reader = BufReader::new(task_file);
                            let mut task_zip_reader =
                                ZipFileReader::with_tokio(&mut task_buf_reader)
                                    .await
                                    .map_err(|e| {
                                        error!(
                                            "Java Task: Failed to read archive as ZIP for '{}': {}",
                                            task_final_dest_path.display(),
                                            e
                                        );
                                        AppError::JavaDownload(format!(
                                            "ZIP Read error in task for {}: {}",
                                            task_final_dest_path.display(),
                                            e
                                        ))
                                    })?;

                            let entry_reader_futures = task_zip_reader
                                .reader_without_entry(original_entry_index)
                                .await
                                .map_err(|e| {
                                    error!(
                                    "Java Task: Failed to get entry reader for '{}' (index {}): {}",
                                    task_final_dest_path.display(), original_entry_index, e
                                );
                                    AppError::JavaDownload(format!(
                                        "Entry reader error for {}: {}",
                                        task_final_dest_path.display(),
                                        e
                                    ))
                                })?;
                            let mut entry_reader_tokio = entry_reader_futures.compat();

                            let mut file_writer =
                                fs::File::create(&task_final_dest_path).await.map_err(|e| {
                                    error!(
                                        "Java Task: Failed to create dest file {:?}: {}",
                                        task_final_dest_path, e
                                    );
                                    AppError::JavaDownload(format!("File create error: {}", e))
                                })?;

                            let bytes_copied =
                                tokio::io::copy(&mut entry_reader_tokio, &mut file_writer)
                                    .await
                                    .map_err(|e| {
                                        error!(
                                            "Java Task: Failed to stream for '{}' to {:?}: {}",
                                            task_final_dest_path.display(),
                                            task_final_dest_path,
                                            e
                                        );
                                        AppError::JavaDownload(format!(
                                            "Streaming copy error: {}",
                                            e
                                        ))
                                    })?;

                            debug!(
                                "Java Task: Streamed {} bytes for: {}",
                                bytes_copied,
                                task_final_dest_path.display()
                            );
                            Ok::<(), AppError>(())
                        }));
                    }
                }

                if !extraction_tasks.is_empty() {
                    info!(
                        "Java Task: Waiting for {} extraction tasks to complete...",
                        extraction_tasks.len()
                    );
                    let results = try_join_all(extraction_tasks).await.map_err(|e| {
                        error!("Error joining Java extraction tasks: {}", e);
                        AppError::JavaDownload(format!("Java extraction tasks panicked: {}", e))
                    })?;

                    for result in results {
                        result?;
                    }
                    info!("Java Task: Successfully extracted all queued Java files.");
                } else {
                    info!("Java Task: No files found or queued for extraction.");
                }
            }
            OperatingSystem::LINUX | OperatingSystem::OSX => {
                // Read the entire archive into memory
                let bytes = fs::read(archive_path).await?;
                let cursor = Cursor::new(bytes);
                let gz = GzDecoder::new(cursor);
                let mut archive = Archive::new(gz);

                // First, find the root directory name
                let mut root_dir = String::new();

                for entry in archive.entries()? {
                    let entry = entry?;
                    let path = entry.path()?;

                    if path.components().count() == 1 {
                        if let Some(name) = path
                            .components()
                            .next()
                            .and_then(|c| c.as_os_str().to_str())
                        {
                            root_dir = name.to_string();
                            break;
                        }
                    }
                }

                // Re-read the archive since we consumed it
                let bytes = fs::read(archive_path).await?;
                let cursor = Cursor::new(bytes);
                let gz = GzDecoder::new(cursor);
                let mut archive = Archive::new(gz);

                // Process entries, skipping the root directory
                for entry_result in archive.entries()? {
                    let mut entry = entry_result?;
                    let path = entry.path()?.to_path_buf();

                    // Skip the root directory itself
                    if path.to_string_lossy() == root_dir {
                        continue;
                    }

                    // Create the path without the root directory
                    let relative_path = if let Ok(rel_path) = path.strip_prefix(&root_dir) {
                        rel_path.to_path_buf()
                    } else {
                        // If stripping fails, just use the original path
                        path
                    };

                    // Skip empty paths
                    if relative_path.as_os_str().is_empty() {
                        continue;
                    }

                    let target_path = target_dir.join(relative_path);

                    // Create parent directories
                    if let Some(parent) = target_path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }

                    entry.unpack(&target_path)?;
                }
            }
            _ => return Err(AppError::JavaDownload("Unsupported OS".to_string())),
        }

        info!("Finished Java archive extraction.");
        Ok(())
    }

    pub async fn find_java_binary(
        &self,
        distribution: &JavaDistribution,
        version: &u32,
        force_x86_64: bool,
    ) -> Result<PathBuf> {
        debug!(
            "Attempting to find Java binary for distribution: {}, version: {}, force_x86_64: {}",
            distribution.get_name(),
            version,
            force_x86_64
        );
        let arch_suffix = if force_x86_64 { "_x86_64" } else { "" };
        let runtime_path = self.base_path.join(format!(
            "{}_{}{}",
            distribution.get_name(),
            version,
            arch_suffix
        ));

        // Now that we extract directly to the target directory without the root folder,
        // we should look for the Java binary directly in standard locations
        let java_binary_paths = match OS {
            OperatingSystem::WINDOWS => vec![
                runtime_path.join("bin").join("javaw.exe"),
                runtime_path.join("jre").join("bin").join("javaw.exe"),
            ],
            OperatingSystem::OSX => vec![
                runtime_path
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join("java"),
                runtime_path.join("bin").join("java"),
                runtime_path.join("jre").join("bin").join("java"),
            ],
            _ => vec![
                runtime_path.join("bin").join("java"),
                runtime_path.join("jre").join("bin").join("java"),
            ],
        };

        // Try all possible paths
        for java_binary in java_binary_paths {
            debug!("Checking for Java binary at: {:?}", java_binary);
            if java_binary.exists() {
                // Check if the binary has execution permissions on linux and macOS
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;

                    let metadata = fs::metadata(&java_binary).await?;

                    if !metadata.permissions().mode() & 0o111 != 0 {
                        // try to change permissions
                        let mut permissions = metadata.permissions();
                        permissions.set_mode(0o111);
                        fs::set_permissions(&java_binary, permissions).await?;
                    }
                }

                debug!("Found Java binary at: {:?}", java_binary);
                return Ok(java_binary);
            }
        }

        debug!(
            "Java binary not found in standard locations for distribution: {}, version: {}. Attempting recursive search.",
            distribution.get_name(),
            version
        );
        // If we couldn't find a binary in the expected locations, let's scan the directory recursively
        self.find_java_binary_recursive(&runtime_path).await
    }

    // Helper method to recursively find Java binary
    async fn find_java_binary_recursive(&self, dir: &PathBuf) -> Result<PathBuf> {
        let binary_name = match OS {
            OperatingSystem::WINDOWS => "javaw.exe",
            _ => "java",
        };
        debug!(
            "Starting recursive search for '{}' in directory: {:?}",
            binary_name, dir
        );

        let mut dirs_to_search = vec![dir.clone()];

        while let Some(current_dir) = dirs_to_search.pop() {
            debug!("Recursively searching in: {:?}", current_dir);
            if let Ok(mut entries) = fs::read_dir(&current_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();

                    if path.is_dir() {
                        dirs_to_search.push(path);
                    } else if path.file_name().and_then(|n| n.to_str()) == Some(binary_name) {
                        debug!("Found Java binary recursively at: {:?}", path);
                        // Found the Java binary
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let metadata = fs::metadata(&path).await?;
                            if metadata.permissions().mode() & 0o111 == 0 {
                                let mut permissions = metadata.permissions();
                                permissions.set_mode(metadata.permissions().mode() | 0o111);
                                fs::set_permissions(&path, permissions).await?;
                            }
                        }
                        return Ok(path);
                    }
                }
            }
        }

        error!(
            "Failed to find Java binary ('{}') recursively in directory: {:?}",
            binary_name, dir
        );
        Err(AppError::JavaDownload(
            "Failed to find Java binary".to_string(),
        ))
    }
}
