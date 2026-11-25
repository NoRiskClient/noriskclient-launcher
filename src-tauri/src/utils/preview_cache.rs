use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::utils::hash_utils::calculate_sha1_from_bytes;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct PreviewSource<'a> {
    pub path: &'a str,
    pub modified_ms: u128,
    pub size: u64,
}

pub fn preview_cache_key(source: &PreviewSource, width: u32, height: u32, quality: u8) -> String {
    calculate_sha1_from_bytes(
        format!("{}|{}|{}|{}x{}|{}", source.path, source.modified_ms, source.size, width, height, quality).as_bytes(),
    )
}

pub async fn thumbnail_path(path: &Path, size: u32) -> Option<PathBuf> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let modified_ms = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
    let source = PreviewSource { path: &path.to_string_lossy(), modified_ms, size: metadata.len() };
    let key = preview_cache_key(&source, size, size, JPEG_QUALITY);
    Some(LAUNCHER_DIRECTORY.meta_dir().join("preview_cache").join(format!("{key}.jpg")))
}

const CACHE_LIMIT: u64 = 128 * 1024 * 1024;
const PRUNE_EVERY: usize = 32;
const JPEG_QUALITY: u8 = 80;

static GENERATED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub fn create_thumbnail(source: &Path, target: &Path, size: u32) -> std::io::Result<()> {
    let mut reader = image::ImageReader::open(source)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    reader.limits(limits);
    let thumbnail = reader.decode().map_err(std::io::Error::other)?.thumbnail(size, size).to_rgb8();
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
        .encode_image(&thumbnail)
        .map_err(std::io::Error::other)?;
    crate::utils::file_utils::write_atomic_sync(target, &bytes).map_err(std::io::Error::other)?;
    if GENERATED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % PRUNE_EVERY == 0 {
        if let Some(dir) = target.parent() {
            let _ = prune(dir, target);
        }
    }
    Ok(())
}

fn prune(cache: &Path, current: &Path) -> std::io::Result<()> {
    let mut entries = Vec::new();
    let mut total = 0;
    for entry in std::fs::read_dir(cache)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file() {
            total += metadata.len();
            entries.push((metadata.modified().unwrap_or(UNIX_EPOCH), metadata.len(), entry.path()));
        }
    }
    entries.sort_unstable_by_key(|(modified, _, _)| *modified);
    for (_, size, path) in entries {
        if total <= CACHE_LIMIT {
            break;
        }
        if path != current && std::fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
    Ok(())
}
