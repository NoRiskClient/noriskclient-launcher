use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use log::{debug, warn};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tokio::fs as tokio_fs;
use tokio::io::AsyncReadExt;

const MIN_VALID_IMAGE_BYTES: u64 = 512;
const ALLOWED_EXTENSIONS: [&str; 2] = ["png", "webp"];

fn looks_like_image(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G'])
        || (bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP")
}

fn sanitize_key(cache_key: &str) -> Result<&str, AppError> {
    let valid = !cache_key.is_empty()
        && cache_key.len() <= 128
        && cache_key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(cache_key)
    } else {
        Err(AppError::Other(format!(
            "Invalid skin render cache key: {}",
            cache_key
        )))
    }
}

fn sanitize_extension(extension: &str) -> Result<&str, AppError> {
    ALLOWED_EXTENSIONS
        .iter()
        .find(|allowed| **allowed == extension)
        .copied()
        .ok_or_else(|| AppError::Other(format!("Unsupported skin render format: {}", extension)))
}

fn cache_dir() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join("render_cache")
}

fn cache_path(cache_key: &str, extension: &str) -> Result<PathBuf, AppError> {
    let key = sanitize_key(cache_key)?;
    let ext = sanitize_extension(extension)?;
    Ok(cache_dir().join(format!("{}.{}", key, ext)))
}

async fn is_valid_image_file(path: &Path) -> bool {
    let metadata = match tokio_fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if metadata.len() < MIN_VALID_IMAGE_BYTES {
        return false;
    }
    let mut file = match tokio_fs::File::open(path).await {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0u8; 12];
    match file.read_exact(&mut magic).await {
        Ok(_) => looks_like_image(&magic),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn get_cached_skin_render(
    cache_key: String,
    extension: String,
) -> Result<Option<PathBuf>, CommandError> {
    let path = cache_path(&cache_key, &extension)?;

    if !path.exists() {
        return Ok(None);
    }

    if !is_valid_image_file(&path).await {
        warn!("Discarding invalid cached skin render: {:?}", path);
        if let Err(e) = tokio_fs::remove_file(&path).await {
            warn!("Failed to remove invalid skin render {:?}: {}", path, e);
        }
        return Ok(None);
    }

    Ok(Some(path))
}

#[tauri::command]
pub async fn store_skin_render(
    cache_key: String,
    extension: String,
    base64_data: String,
) -> Result<PathBuf, CommandError> {
    let path = cache_path(&cache_key, &extension)?;

    let bytes = BASE64
        .decode(base64_data.as_bytes())
        .map_err(|e| AppError::Other(format!("Failed to decode skin render: {}", e)))?;

    if !looks_like_image(&bytes) || (bytes.len() as u64) < MIN_VALID_IMAGE_BYTES {
        return Err(CommandError::from(AppError::Other(format!(
            "Refusing to cache a skin render that is not an image ({} bytes)",
            bytes.len()
        ))));
    }

    tokio_fs::create_dir_all(cache_dir()).await.map_err(|e| {
        AppError::Other(format!(
            "Failed to create skin render cache directory: {}",
            e
        ))
    })?;

    tokio_fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::Other(format!("Failed to write skin render: {}", e)))?;

    debug!("Cached skin render at {:?} ({} bytes)", path, bytes.len());
    Ok(path)
}

pub async fn prune_skin_renders(max_age_days: u64) -> Result<u32, AppError> {
    let dir = cache_dir();
    if !dir.exists() {
        return Ok(0);
    }

    let max_age = Duration::from_secs(max_age_days.max(1) * 24 * 60 * 60);
    let now = SystemTime::now();

    let mut entries = tokio_fs::read_dir(&dir)
        .await
        .map_err(|e| AppError::Other(format!("Failed to read skin render cache: {}", e)))?;

    let mut removed = 0u32;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let modified = match entry.metadata().await.and_then(|m| m.modified()) {
            Ok(modified) => modified,
            Err(_) => continue,
        };
        let age = match now.duration_since(modified) {
            Ok(age) => age,
            Err(_) => continue,
        };
        if age > max_age && tokio_fs::remove_file(&path).await.is_ok() {
            removed += 1;
        }
    }

    if removed > 0 {
        debug!("Pruned {} skin renders older than {:?}", removed, max_age);
    }
    Ok(removed)
}
