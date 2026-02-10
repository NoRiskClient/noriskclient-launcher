use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use crate::utils::hash_utils;
use crate::utils::disk_space_utils::DiskSpaceUtils;
use futures::stream::StreamExt;
use log::{debug, error, info, warn};
use reqwest::Response;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use crate::utils::string_utils::safe_truncate;

/// Configuration for file downloads
pub struct DownloadConfig {
    /// Expected SHA1 hash for verification (optional)
    pub expected_sha1: Option<String>,
    /// Expected SHA256 hash for verification (optional)
    pub expected_sha256: Option<String>,
    /// Expected file size for verification (optional)
    pub expected_size: Option<u64>,
    /// Whether to use streaming download (recommended for large files)
    pub use_streaming: bool,
    /// Whether to overwrite existing files even if they pass verification
    pub force_overwrite: bool,
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Custom user agent to use for the request
    pub user_agent: Option<String>,
    /// Progress callback function
    pub progress_callback: Option<Box<dyn Fn(u64, Option<u64>) + Send + Sync>>,
    /// Check disk space before download (default: true)
    pub check_disk_space: bool,
    /// Buffer percentage for disk space check (default: 0.25 = 25%)
    pub disk_space_buffer: f64,
}

impl std::fmt::Debug for DownloadConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DownloadConfig")
            .field("expected_sha1", &self.expected_sha1)
            .field("expected_sha256", &self.expected_sha256)
            .field("expected_size", &self.expected_size)
            .field("use_streaming", &self.use_streaming)
            .field("force_overwrite", &self.force_overwrite)
            .field("max_retries", &self.max_retries)
            .field("user_agent", &self.user_agent)
            .field("progress_callback", &"<callback function>")
            .field("check_disk_space", &self.check_disk_space)
            .field("disk_space_buffer", &self.disk_space_buffer)
            .finish()
    }
}

impl Clone for DownloadConfig {
    fn clone(&self) -> Self {
        Self {
            expected_sha1: self.expected_sha1.clone(),
            expected_sha256: self.expected_sha256.clone(),
            expected_size: self.expected_size,
            use_streaming: self.use_streaming,
            force_overwrite: self.force_overwrite,
            max_retries: self.max_retries,
            user_agent: self.user_agent.clone(),
            // Note: progress_callback cannot be cloned, so we set it to None
            // This is acceptable since cloning is mainly used for configuration templates
            progress_callback: None,
            check_disk_space: self.check_disk_space,
            disk_space_buffer: self.disk_space_buffer,
        }
    }
}

impl Default for DownloadConfig {
    fn default() -> Self {
        Self {
            expected_sha1: None,
            expected_sha256: None,
            expected_size: None,
            use_streaming: true,
            force_overwrite: false,
            max_retries: 3,
            user_agent: Some(format!(
                "NoRiskClient-Launcher/{} (support@norisk.gg)",
                env!("CARGO_PKG_VERSION")
            )),
            progress_callback: None,
            check_disk_space: true,
            disk_space_buffer: 0.25, // 25% buffer by default
        }
    }
}

impl DownloadConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_sha1<S: Into<String>>(mut self, sha1: S) -> Self {
        self.expected_sha1 = Some(sha1.into());
        self
    }

    pub fn with_sha256<S: Into<String>>(mut self, sha256: S) -> Self {
        self.expected_sha256 = Some(sha256.into());
        self
    }

    pub fn with_size(mut self, size: u64) -> Self {
        self.expected_size = Some(size);
        self
    }

    pub fn with_streaming(mut self, use_streaming: bool) -> Self {
        self.use_streaming = use_streaming;
        self
    }

    pub fn with_force_overwrite(mut self, force: bool) -> Self {
        self.force_overwrite = force;
        self
    }

    pub fn with_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    pub fn with_user_agent<S: Into<String>>(mut self, user_agent: S) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    pub fn with_progress_callback<F>(mut self, callback: F) -> Self
    where
        F: Fn(u64, Option<u64>) + Send + Sync + 'static,
    {
        self.progress_callback = Some(Box::new(callback));
        self
    }

    pub fn with_disk_space_check(mut self, check: bool) -> Self {
        self.check_disk_space = check;
        self
    }

    pub fn with_disk_space_buffer(mut self, buffer_percentage: f64) -> Self {
        self.disk_space_buffer = buffer_percentage;
        self
    }
}

/// Central download utility for robust file downloads
pub struct DownloadUtils;

impl DownloadUtils {
    /// Downloads a file from URL to target path with comprehensive verification and error handling
    pub async fn download_file<P: AsRef<Path>>(
        url: &str,
        target_path: P,
        config: DownloadConfig,
    ) -> Result<()> {
        let target_path = target_path.as_ref();
        debug!("Starting download: {} -> {:?}", url, target_path);

        // Check if file already exists and is valid
        if !config.force_overwrite && Self::verify_existing_file(target_path, &config).await? {
            info!("File already exists and passes verification: {:?}", target_path);
            return Ok(());
        }

        // Check disk space before attempting download
        if config.check_disk_space {
            // Estimate download size based on expected_size or a reasonable default
            let estimated_size = config.expected_size.unwrap_or(100 * 1024 * 1024); // Default to 100MB if unknown
            
            if let Err(e) = DiskSpaceUtils::ensure_space_for_download(
                target_path,
                estimated_size,
                config.disk_space_buffer,
            ).await {
                error!("Disk space check failed for {}: {}", url, e);
                return Err(e);
            }
        }

        let mut attempt = 0;
        let mut last_error = None;

        while attempt <= config.max_retries {
            if attempt > 0 {
                warn!("Retry attempt {}/{} for: {}", attempt, config.max_retries, url);
            }

            match Self::download_attempt(url, target_path, &config).await {
                Ok(()) => {
                    info!("Successfully downloaded: {} -> {:?}", url, target_path);
                    return Ok(());
                }
                Err(e) => {
                    error!("Download attempt {} failed for {}: {}", attempt + 1, url, e);
                    last_error = Some(e);
                    attempt += 1;
                    
                    if attempt <= config.max_retries {
                        // Clean up partially downloaded file
                        if target_path.exists() {
                            debug!("Cleaning up partially downloaded file: {:?}", target_path);
                            if let Err(cleanup_err) = fs::remove_file(target_path).await {
                                warn!("Failed to clean up partial file {:?}: {}", target_path, cleanup_err);
                            }
                        }
                        
                        if attempt < config.max_retries {
                            info!("Retrying download in next attempt...");
                        }
                    }
                }
            }
        }

        let final_error = last_error.unwrap_or_else(|| {
            AppError::Download("Unknown download error".to_string())
        });
        
        error!(
            "Download failed after {} attempts for {}: {}", 
            config.max_retries + 1, url, final_error
        );
        
        Err(final_error)
    }

    /// Simplified download function with minimal configuration
    pub async fn download_simple<P: AsRef<Path>>(url: &str, target_path: P) -> Result<()> {
        Self::download_file(url, target_path, DownloadConfig::default()).await
    }

    /// Download with SHA1 verification
    pub async fn download_with_sha1<P: AsRef<Path>>(
        url: &str,
        target_path: P,
        expected_sha1: &str,
    ) -> Result<()> {
        let config = DownloadConfig::default().with_sha1(expected_sha1);
        Self::download_file(url, target_path, config).await
    }

    /// Download with size verification
    pub async fn download_with_size<P: AsRef<Path>>(
        url: &str,
        target_path: P,
        expected_size: u64,
    ) -> Result<()> {
        let config = DownloadConfig::default().with_size(expected_size);
        Self::download_file(url, target_path, config).await
    }

    /// Single download attempt
    async fn download_attempt(
        url: &str,
        target_path: &Path,
        config: &DownloadConfig,
    ) -> Result<()> {
        // Create parent directories
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                AppError::Download(format!(
                    "Failed to create parent directory for {:?}: {}",
                    target_path, e
                ))
            })?;
        }

        // Make HTTP request
        let mut request = HTTP_CLIENT.get(url);
        
        if let Some(user_agent) = &config.user_agent {
            request = request.header("User-Agent", user_agent);
        }

        let response = request.send().await.map_err(|e| {
            let error_msg = format!("HTTP request failed for {}: {}", url, e);
            error!("{}", error_msg);
            AppError::Download(error_msg)
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_msg = format!(
                "Download failed: {} returned status {} ({})",
                url, status.as_u16(), status.canonical_reason().unwrap_or("Unknown")
            );
            error!("{}", error_msg);
            
            // Try to get response body for more details (but limit to avoid hanging)
            if let Ok(body) = response.text().await {
                let truncated_body = if body.len() > 200 {
                    format!("{}...", safe_truncate(&body, 200))
                } else {
                    body
                };
                error!("Response body: {}", truncated_body);
            }
            
            return Err(AppError::Download(error_msg));
        }

        // Get content length for progress tracking
        let content_length = response.content_length();

        if config.use_streaming {
            Self::download_streaming(response, target_path, config, content_length).await
        } else {
            Self::download_in_memory(response, target_path, config, url).await
        }
    }

    /// Download using streaming (recommended for large files)
    async fn download_streaming(
        response: Response,
        target_path: &Path,
        config: &DownloadConfig,
        content_length: Option<u64>,
    ) -> Result<()> {
        debug!("Creating file for streaming download: {:?}", target_path);
        let mut file = fs::File::create(target_path).await.map_err(|e| {
            let error_msg = format!("Failed to create file {:?}: {}", target_path, e);
            error!("{}", error_msg);
            AppError::Download(error_msg)
        })?;

        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;
        let mut chunk_count = 0u64;

        debug!("Starting streaming download (content_length: {:?})", content_length);
        
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| {
                let error_msg = format!("Stream error during download: {}", e);
                error!("{}", error_msg);
                AppError::Download(error_msg)
            })?;

            file.write_all(&chunk).await.map_err(|e| {
                let error_msg = format!("Write error for {:?}: {}", target_path, e);
                error!("{}", error_msg);
                AppError::Download(error_msg)
            })?;

            downloaded += chunk.len() as u64;
            chunk_count += 1;

            // Log progress every 1000 chunks or every 10MB for large downloads
            if chunk_count % 1000 == 0 || downloaded % (10 * 1024 * 1024) == 0 {
                debug!("Downloaded {} bytes in {} chunks", downloaded, chunk_count);
            }

            // Call progress callback if provided
            if let Some(callback) = &config.progress_callback {
                callback(downloaded, content_length);
            }
        }

        debug!("Completed streaming download: {} bytes in {} chunks", downloaded, chunk_count);

        // Ensure file is fully written to disk - CRITICAL for preventing corruption
        file.sync_all().await.map_err(|e| {
            AppError::Download(format!("Failed to sync file {:?}: {}", target_path, e))
        })?;

        // Explicitly close the file handle
        drop(file);

        // Verify the downloaded file
        Self::verify_downloaded_file(target_path, config).await
    }

    /// Download by loading entire response into memory (for small files)
    async fn download_in_memory(
        response: Response,
        target_path: &Path,
        config: &DownloadConfig,
        url: &str,
    ) -> Result<()> {
        let bytes = response.bytes().await.map_err(|e| {
            AppError::Download(format!("Failed to read response bytes: {}", e))
        })?;

        // Call progress callback if provided
        if let Some(callback) = &config.progress_callback {
            callback(bytes.len() as u64, Some(bytes.len() as u64));
        }

        // Verify hash before writing (for in-memory downloads)
        if let Some(expected_sha1) = &config.expected_sha1 {
            debug!("Verifying SHA1 hash for downloaded content ({} bytes)", bytes.len());
            let calculated_hash = hash_utils::calculate_sha1_from_bytes(&bytes);
            if !calculated_hash.eq_ignore_ascii_case(expected_sha1) {
                let error_msg = format!(
                    "SHA1 hash mismatch (pre-write) for {}: expected {}, got {}",
                    url, expected_sha1, calculated_hash
                );
                error!("{}", error_msg);
                return Err(AppError::Download(error_msg));
            }
            debug!("SHA1 hash verification passed");
        }

        if let Some(expected_sha256) = &config.expected_sha256 {
            debug!("Verifying SHA256 hash for downloaded content ({} bytes)", bytes.len());
            let calculated_hash = hash_utils::calculate_sha256_from_bytes(&bytes);
            if !calculated_hash.eq_ignore_ascii_case(expected_sha256) {
                let error_msg = format!(
                    "SHA256 hash mismatch (pre-write) for {}: expected {}, got {}",
                    url, expected_sha256, calculated_hash
                );
                error!("{}", error_msg);
                return Err(AppError::Download(error_msg));
            }
            debug!("SHA256 hash verification passed");
        }

        let mut file = fs::File::create(target_path).await.map_err(|e| {
            AppError::Download(format!("Failed to create file {:?}: {}", target_path, e))
        })?;

        file.write_all(&bytes).await.map_err(|e| {
            AppError::Download(format!("Failed to write file {:?}: {}", target_path, e))
        })?;

        // Ensure file is fully written to disk - CRITICAL for preventing corruption
        file.sync_all().await.map_err(|e| {
            AppError::Download(format!("Failed to sync file {:?}: {}", target_path, e))
        })?;

        // Explicitly close the file handle
        drop(file);

        // Verify size after writing
        if let Some(expected_size) = config.expected_size {
            let metadata = fs::metadata(target_path).await.map_err(|e| {
                AppError::Download(format!("Failed to read metadata for {:?}: {}", target_path, e))
            })?;
            
            if metadata.len() != expected_size {
                return Err(AppError::Download(format!(
                    "Size mismatch for {:?}: expected {}, got {}",
                    target_path, expected_size, metadata.len()
                )));
            }
        }

        Ok(())
    }

    /// Check if existing file passes all verifications
    async fn verify_existing_file(target_path: &Path, config: &DownloadConfig) -> Result<bool> {
        if !target_path.exists() {
            return Ok(false);
        }

        debug!("Verifying existing file: {:?}", target_path);

        // ZIP integrity check FIRST for JAR files - fastest way to detect corruption
        if let Some(extension) = target_path.extension() {
            if extension == "jar" && !Self::is_zip_file_complete(target_path).await {
                debug!(
                    "Existing JAR file failed ZIP integrity check (corrupt): {:?}",
                    target_path
                );
                return Ok(false);
            }
        }

        // Check size (fast metadata check)
        if let Some(expected_size) = config.expected_size {
            let metadata = fs::metadata(target_path).await?;
            if metadata.len() != expected_size {
                debug!(
                    "Size mismatch for existing file {:?}: expected {}, got {}",
                    target_path, expected_size, metadata.len()
                );
                return Ok(false);
            }
        }

        // Check SHA1 hash (slower - reads entire file)
        if let Some(expected_sha1) = &config.expected_sha1 {
            let calculated_hash = hash_utils::calculate_sha1_from_file(target_path).await?;
            if !calculated_hash.eq_ignore_ascii_case(expected_sha1) {
                debug!(
                    "SHA1 mismatch for existing file {:?}: expected {}, got {}",
                    target_path, expected_sha1, calculated_hash
                );
                return Ok(false);
            }
        }

        // Check SHA256 hash (slowest - reads entire file)
        if let Some(expected_sha256) = &config.expected_sha256 {
            let calculated_hash = hash_utils::calculate_sha256_from_file(target_path).await?;
            if !calculated_hash.eq_ignore_ascii_case(expected_sha256) {
                debug!(
                    "SHA256 mismatch for existing file {:?}: expected {}, got {}",
                    target_path, expected_sha256, calculated_hash
                );
                return Ok(false);
            }
        }

        debug!("Existing file passed all verifications: {:?}", target_path);
        Ok(true)
    }

    /// Verify downloaded file after writing
    async fn verify_downloaded_file(target_path: &Path, config: &DownloadConfig) -> Result<()> {
        debug!("Verifying downloaded file: {:?}", target_path);

        // Check size
        if let Some(expected_size) = config.expected_size {
            let metadata = fs::metadata(target_path).await.map_err(|e| {
                AppError::Download(format!("Failed to read metadata for {:?}: {}", target_path, e))
            })?;
            
            if metadata.len() != expected_size {
                return Err(AppError::Download(format!(
                    "Size mismatch after download for {:?}: expected {}, got {}",
                    target_path, expected_size, metadata.len()
                )));
            }
        }

        // Check SHA1 hash
        if let Some(expected_sha1) = &config.expected_sha1 {
            debug!("Verifying SHA1 hash for downloaded file: {:?}", target_path);
            let calculated_hash = hash_utils::calculate_sha1_from_file(target_path).await?;
            if !calculated_hash.eq_ignore_ascii_case(expected_sha1) {
                let error_msg = format!(
                    "SHA1 mismatch after download for {:?}: expected {}, got {}",
                    target_path, expected_sha1, calculated_hash
                );
                error!("{}", error_msg);
                return Err(AppError::Download(error_msg));
            }
            debug!("SHA1 hash verification passed for downloaded file");
        }

        // Check SHA256 hash
        if let Some(expected_sha256) = &config.expected_sha256 {
            debug!("Verifying SHA256 hash for downloaded file: {:?}", target_path);
            let calculated_hash = hash_utils::calculate_sha256_from_file(target_path).await?;
            if !calculated_hash.eq_ignore_ascii_case(expected_sha256) {
                let error_msg = format!(
                    "SHA256 mismatch after download for {:?}: expected {}, got {}",
                    target_path, expected_sha256, calculated_hash
                );
                error!("{}", error_msg);
                return Err(AppError::Download(error_msg));
            }
            debug!("SHA256 hash verification passed for downloaded file");
        }

        // Additional ZIP integrity check for JAR files to detect incomplete downloads
        if let Some(extension) = target_path.extension() {
            if extension == "jar" && !Self::is_zip_file_complete(target_path).await {
                let error_msg = format!(
                    "Downloaded JAR file failed ZIP integrity check (incomplete/corrupt): {:?}",
                    target_path
                );
                error!("{}", error_msg);
                return Err(AppError::Download(error_msg));
            }
        }

        debug!("Downloaded file passed all verifications: {:?}", target_path);
        Ok(())
    }

    /// fix for https://github.com/NoRiskClient/issues/issues/1487
    /// Comprehensive ZIP file integrity check - detects incomplete/corrupt JAR files
    /// Checks both ZIP header and End of Central Directory record
    pub async fn is_zip_file_complete(file_path: &Path) -> bool {
        use tokio::io::{AsyncReadExt, AsyncSeekExt};
        use std::io::SeekFrom;

        let mut file = match fs::File::open(file_path).await {
            Ok(f) => f,
            Err(_) => {
                debug!("Failed to open file for ZIP check: {:?}", file_path);
                return false;
            }
        };

        // 1. Check ZIP header (PK signature)
        let mut header = [0u8; 4];
        if let Err(_) = file.read_exact(&mut header).await {
            debug!("Failed to read ZIP header: {:?}", file_path);
            return false;
        }
        
        if header[0] != 0x50 || header[1] != 0x4B {
            debug!("Invalid ZIP header detected: {:?}", file_path);
            return false;
        }

        // 2. Check End of Central Directory Record (EOCD)
        // EOCD signature is "PK\x05\x06" and should be near the end of the file
        let file_size = match file.metadata().await {
            Ok(meta) => meta.len(),
            Err(_) => {
                debug!("Failed to get file size for ZIP check: {:?}", file_path);
                return false;
            }
        };

        if file_size < 22 {
            debug!("File too small to be valid ZIP: {:?}", file_path);
            return false;
        }

        // Search for EOCD signature in last 65557 bytes (max comment size + EOCD size)
        let search_size = std::cmp::min(65557, file_size as usize);
        let start_pos = file_size - search_size as u64;

        if let Err(_) = file.seek(SeekFrom::Start(start_pos)).await {
            debug!("Failed to seek in file for EOCD check: {:?}", file_path);
            return false;
        }

        let mut buffer = vec![0u8; search_size];
        if let Err(_) = file.read_exact(&mut buffer).await {
            debug!("Failed to read end of file for EOCD check: {:?}", file_path);
            return false;
        }

        // Search for EOCD signature (PK\x05\x06) from the end
        for i in (0..buffer.len().saturating_sub(3)).rev() {
            if buffer[i] == 0x50 && buffer[i+1] == 0x4B && 
               buffer[i+2] == 0x05 && buffer[i+3] == 0x06 {
                debug!("ZIP integrity check passed: {:?}", file_path);
                return true;
            }
        }

        debug!("EOCD signature not found - ZIP file incomplete: {:?}", file_path);
        false
    }
}