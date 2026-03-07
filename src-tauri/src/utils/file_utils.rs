use crate::error::{AppError, Result};
use async_zip::error::ZipError;
use async_zip::tokio::read::seek::ZipFileReader;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::AsyncReadExt;
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use log::debug;
use std::path::Path;
use tokio::fs::File;

/// Helper function to read a specific zip entry by index and encode it as Base64
async fn read_zip_entry_as_base64(
    zip: &mut ZipFileReader<tokio::io::BufReader<tokio::fs::File>>,
    entry_index: usize,
    entry_filename_for_error: &str,
) -> Result<String> {
    let mut entry_reader = zip.reader_with_entry(entry_index).await.map_err(|e| {
        AppError::ArchiveReadError(format!(
            "Failed to create reader for entry {}: {}",
            entry_filename_for_error, e
        ))
    })?;

    let mut buffer = Vec::new();
    entry_reader.read_to_end(&mut buffer).await.map_err(|e| {
        AppError::ArchiveReadError(format!(
            "Failed to read content of {}: {}",
            entry_filename_for_error, e
        ))
    })?;

    let base64_string = STANDARD.encode(&buffer);
    Ok(base64_string)
}

/// Finds the first `.png` file within a zip or jar archive and returns its content as a Base64 encoded string.
/// Prioritizes pack.png, then icon.png in root, then other root PNGs, then any subdirectory PNG.
///
/// # Arguments
///
/// * `archive_path` - The path to the `.zip` or `.jar` file.
///
/// # Returns
///
/// A `Result` containing the Base64 encoded string of the first PNG found, or an `AppError`.
pub async fn find_first_png_in_archive_as_base64(archive_path: &Path) -> Result<String> {
    if !archive_path.exists() {
        debug!("Archive not found at path: {}", archive_path.display());
        return Err(AppError::FileNotFound(archive_path.to_path_buf()));
    }
    debug!(
        "Attempting to find PNG in archive: {}",
        archive_path.display()
    );

    let file = File::open(archive_path)
        .await
        .map_err(|e| AppError::Io(e))?;
    let mut reader = tokio::io::BufReader::new(file);

    let mut zip = ZipFileReader::with_tokio(reader).await.map_err(|e| {
        AppError::ArchiveReadError(format!(
            "Failed to read archive {}: {}",
            archive_path.display(),
            e
        ))
    })?;

    let entries = zip.file().entries().to_vec(); // Clone to allow mutable borrow of zip later

    let mut root_pack_png_idx: Option<usize> = None;
    let mut root_icon_png_idx: Option<usize> = None;
    let mut first_other_root_png_idx: Option<usize> = None;
    let mut first_subdir_png_idx: Option<usize> = None;

    for index in 0..entries.len() {
        let entry = match entries.get(index) {
            Some(e) => e,
            None => continue, // Should not happen if iterating up to entries.len()
        };

        let filename = match entry.filename().as_str() {
            Ok(s) => s,
            Err(_) => {
                debug!("Skipping entry with non-UTF8 filename at index {}", index);
                continue; // Skip non-UTF8 filenames
            }
        };

        if !filename.to_lowercase().ends_with(".png") {
            continue; // Not a PNG file
        }

        let is_root_file = !filename.contains('/');

        if is_root_file {
            if filename.eq_ignore_ascii_case("pack.png") {
                if root_pack_png_idx.is_none() {
                    debug!("Found potential root 'pack.png': {}", filename);
                    root_pack_png_idx = Some(index);
                }
            } else if filename.eq_ignore_ascii_case("icon.png") {
                if root_icon_png_idx.is_none() {
                    debug!("Found potential root 'icon.png': {}", filename);
                    root_icon_png_idx = Some(index);
                }
            } else {
                if first_other_root_png_idx.is_none() {
                    debug!("Found potential other root PNG: {}", filename);
                    first_other_root_png_idx = Some(index);
                }
            }
        } else {
            // Is a subdirectory file
            if first_subdir_png_idx.is_none() {
                debug!("Found potential subdirectory PNG: {}", filename);
                first_subdir_png_idx = Some(index);
            }
        }
    }

    // Determine which index to use based on priority
    let final_idx_to_read: Option<usize> = root_pack_png_idx
        .or(root_icon_png_idx)
        .or(first_other_root_png_idx)
        .or(first_subdir_png_idx);

    if let Some(index_to_read) = final_idx_to_read {
        let entry_to_read = entries.get(index_to_read).unwrap(); // Safe due to previous checks
        let filename_for_error = entry_to_read
            .filename()
            .as_str()
            .unwrap_or("[unknown filename]")
            .to_string(); // Fallback for error

        debug!(
            "Selected PNG to read: {} (index {})",
            filename_for_error, index_to_read
        );
        return read_zip_entry_as_base64(&mut zip, index_to_read, &filename_for_error).await;
    }

    debug!("No PNG found in archive: {}", archive_path.display());
    Err(AppError::PngNotFoundInArchive(archive_path.to_path_buf()))
}

pub async fn get_jar_icon_test() {
    // Verwende einen Raw-String für den Windows-Pfad
    let path_str = r"C:\Users\sheesh\AppData\Roaming\norisk\NoRiskClientV3\meta\mod_cache\§fAbsolute §7[§f16x§7]§8.zip";
    let archive_path = Path::new(path_str);

    match find_first_png_in_archive_as_base64(archive_path).await {
        Ok(base64_icon) => {
            log::debug!(
                "Erstes PNG als Base64 gefunden (erste 50 Zeichen): {}...",
                &base64_icon[..50.min(base64_icon.len())]
            );
            // Hier kannst du den base64_icon String verwenden
        }
        Err(AppError::PngNotFoundInArchive(path)) => {
            log::debug!("Fehler: Kein PNG im Archiv gefunden: {:?}", path);
        }
        Err(AppError::FileNotFound(path)) => {
            log::debug!("Fehler: Archivdatei nicht gefunden: {:?}", path);
        }
        Err(AppError::ArchiveReadError(msg)) => {
            log::debug!("Fehler beim Lesen des Archivs: {}", msg);
        }
        Err(e) => {
            log::debug!("Ein unerwarteter Fehler ist aufgetreten: {}", e);
        }
    }
}


/// Reads the content of a file into a string, replacing invalid UTF-8 sequences.
///
/// If the file doesn't exist, returns `Ok("".to_string())`.
///
/// # Arguments
///
/// * `file_path` - The path to the file to read.
///
/// # Returns
///
/// A `Result` containing the file content as a `String`, or an `AppError` if reading fails.
pub async fn read_file_content_lossy(file_path: &Path) -> Result<String> {
    // Check if the file exists
    if !file_path.exists() {
        log::warn!(
            "File not found at {}, returning empty content.",
            file_path.display()
        );
        return Ok("".to_string()); // Return empty string if file not found
    }

    // Read file content as bytes first to handle potential invalid UTF-8
    match tokio::fs::read(file_path).await {
        Ok(bytes) => {
            // Convert bytes to string, replacing invalid sequences
            let content = String::from_utf8_lossy(&bytes).to_string();
            log::info!(
                "Successfully read {} bytes (lossy converted) from file {}",
                bytes.len(),
                file_path.display()
            );
            Ok(content)
        }
        Err(e) => {
            log::error!("Failed to read file content {}: {}", file_path.display(), e);
            Err(AppError::Io(e))
        }
    }
}

/// Reads the content of a log file (`.log` or `.log.gz`) into a string.
/// Supports plain text and gzip compressed files.
///
/// If the file doesn't exist, returns `Ok("".to_string())`.
/// Invalid UTF-8 sequences are replaced lossily.
///
/// # Arguments
///
/// * `log_path` - The path to the log file.
///
/// # Returns
///
/// A `Result` containing the log content as a `String`, or an `AppError` if reading or decompression fails.
pub async fn read_log_file_content(log_path: &Path) -> Result<String> {
    // Check if the file exists
    if !log_path.exists() {
        log::warn!(
            "Log file not found at {}, returning empty content.",
            log_path.display()
        );
        return Ok("".to_string()); // Return empty string if file not found
    }

    let filename = log_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    if filename.ends_with(".log.gz") {
        // Handle gzipped file
        log::debug!("Reading gzipped log file: {}", log_path.display());
        match tokio::fs::File::open(log_path).await {
            Ok(file) => {
                let buf_reader = tokio::io::BufReader::new(file);
                let mut decoder = async_compression::tokio::bufread::GzipDecoder::new(buf_reader);
                let mut decompressed_bytes = Vec::new();
                match tokio::io::copy(&mut decoder, &mut decompressed_bytes).await {
                    Ok(bytes_copied) => {
                        let raw_content = String::from_utf8_lossy(&decompressed_bytes).to_string();
                        // Mask sensitive information before returning
                        let safe_content = crate::utils::security_utils::mask_sensitive_data(&raw_content);
                        log::info!(
                            "Successfully read and decompressed {} bytes from gzipped log file {}",
                            bytes_copied,
                            log_path.display()
                        );
                        Ok(safe_content)
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to decompress gzipped log file {}: {}",
                            log_path.display(),
                            e
                        );
                        Err(AppError::Io(e))
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to open gzipped log file {}: {}",
                    log_path.display(),
                    e
                );
                Err(AppError::Io(e))
            }
        }
    } else if filename.ends_with(".log") || filename.ends_with(".txt") {
        // Handle plain text file (.log or .txt for crash reports) using existing function, then mask sensitive data
        log::debug!("Reading plain text log/crash file: {}", log_path.display());
        match read_file_content_lossy(log_path).await {
            Ok(raw_content) => {
                // Mask sensitive information before returning
                let safe_content = crate::utils::security_utils::mask_sensitive_data(&raw_content);
                Ok(safe_content)
            }
            Err(e) => Err(e),
        }
    } else {
        // Handle unsupported file type
        log::warn!(
            "Unsupported log file type at {}, returning empty content.",
            log_path.display()
        );
        Ok("".to_string()) // Or return an error if preferred
    }
}
