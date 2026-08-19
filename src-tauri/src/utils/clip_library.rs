use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    pub path: PathBuf,
    pub name: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub used_bytes: u64,
    /// `0` when no limit is set.
    pub limit_bytes: u64,
    pub clip_count: usize,
}

pub fn list(dir: &Path) -> Result<Vec<ClipEntry>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(AppError::Other(format!(
                "could not read the clip folder {}: {e}",
                dir.display()
            )))
        }
    };

    let mut clips: Vec<ClipEntry> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.extension()?.to_str()?.eq_ignore_ascii_case("mp4") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some(ClipEntry {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                size_bytes: metadata.len(),
                created_at: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
                path,
            })
        })
        .collect();

    clips.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(clips)
}

pub fn delete(dir: &Path, path: &Path) -> Result<()> {
    let dir = dir
        .canonicalize()
        .map_err(|e| AppError::Other(format!("clip folder is unreadable: {e}")))?;
    let path = path
        .canonicalize()
        .map_err(|e| AppError::Other(format!("that clip no longer exists: {e}")))?;

    if !path.starts_with(&dir) {
        return Err(AppError::Other(
            "refusing to delete a file outside the clip folder".into(),
        ));
    }
    if path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
        != Some("mp4".into())
    {
        return Err(AppError::Other("refusing to delete a non-clip file".into()));
    }

    std::fs::remove_file(&path)
        .map_err(|e| AppError::Other(format!("could not delete {}: {e}", path.display())))
}

pub fn usage(dir: &Path, limit_gb: u32) -> Result<StorageUsage> {
    let clips = list(dir)?;
    Ok(StorageUsage {
        used_bytes: clips.iter().map(|c| c.size_bytes).sum(),
        limit_bytes: limit_gb as u64 * 1024 * 1024 * 1024,
        clip_count: clips.len(),
    })
}

pub fn enforce_limit(dir: &Path, limit_gb: u32) -> Result<Vec<PathBuf>> {
    if limit_gb == 0 {
        return Ok(Vec::new());
    }
    let limit = limit_gb as u64 * 1024 * 1024 * 1024;

    let clips = list(dir)?;
    let mut total: u64 = clips.iter().map(|c| c.size_bytes).sum();
    if total <= limit {
        return Ok(Vec::new());
    }

    let mut removed = Vec::new();
    for clip in clips.iter().rev() {
        if total <= limit {
            break;
        }
        match std::fs::remove_file(&clip.path) {
            Ok(()) => {
                total = total.saturating_sub(clip.size_bytes);
                removed.push(clip.path.clone());
            }
            Err(e) => {
                log::warn!("Could not delete {} while enforcing the storage limit: {e}", clip.path.display());
            }
        }
    }

    if !removed.is_empty() {
        log::info!(
            "Storage limit of {limit_gb} GB reached: deleted {} old clip(s)",
            removed.len()
        );
    }
    Ok(removed)
}

pub fn trimmed_destination(dir: &Path, source: &Path) -> Result<PathBuf> {
    let dir = dir
        .canonicalize()
        .map_err(|e| AppError::Other(format!("clip folder is unreadable: {e}")))?;
    let source = source
        .canonicalize()
        .map_err(|e| AppError::Other(format!("that clip no longer exists: {e}")))?;

    if !source.starts_with(&dir) {
        return Err(AppError::Other(
            "refusing to trim a file outside the clip folder".into(),
        ));
    }
    if source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        != Some("mp4".into())
    {
        return Err(AppError::Other("refusing to trim a non-clip file".into()));
    }

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Other("that clip has no usable name".into()))?;

    let base = stem.rsplit_once("_trimmed").map_or(stem, |(head, _)| head);

    for attempt in 0..1000 {
        let name = if attempt == 0 {
            format!("{base}_trimmed.mp4")
        } else {
            format!("{base}_trimmed{}.mp4", attempt + 1)
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::Other(
        "there are already a thousand trims of this clip".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_clip(dir: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, vec![0u8; bytes]).unwrap();
        path
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nrc-clip-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_folder_is_empty_rather_than_an_error() {
        let dir = std::env::temp_dir().join("nrc-clip-test-does-not-exist");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(list(&dir).unwrap().is_empty());
    }

    #[test]
    fn only_mp4_files_are_listed() {
        let dir = temp_dir("filter");
        write_clip(&dir, "a.mp4", 10);
        write_clip(&dir, "notes.txt", 10);
        write_clip(&dir, "b.MP4", 10);

        let names: Vec<_> = list(&dir).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names.len(), 2, "got {names:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_removes_the_oldest_until_it_fits() {
        let clips = [
            ClipEntry { path: "new.mp4".into(), name: "new".into(), size_bytes: 40, created_at: 300 },
            ClipEntry { path: "mid.mp4".into(), name: "mid".into(), size_bytes: 40, created_at: 200 },
            ClipEntry { path: "old.mp4".into(), name: "old".into(), size_bytes: 40, created_at: 100 },
        ];

        let limit = 100u64;
        let mut total: u64 = clips.iter().map(|c| c.size_bytes).sum();
        let mut removed = Vec::new();
        for clip in clips.iter().rev() {
            if total <= limit {
                break;
            }
            total -= clip.size_bytes;
            removed.push(clip.name.clone());
        }

        assert_eq!(removed, vec!["old"], "the oldest goes first, and only as many as needed");
        assert!(total <= limit);
    }

    #[test]
    fn a_zero_limit_disables_cleanup() {
        let dir = temp_dir("nolimit");
        write_clip(&dir, "a.mp4", 1024);
        assert!(enforce_limit(&dir, 0).unwrap().is_empty());
        assert_eq!(list(&dir).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_outside_the_clip_folder_is_refused() {
        let dir = temp_dir("guard");
        let outside = std::env::temp_dir().join("nrc-not-a-clip.mp4");
        std::fs::write(&outside, b"x").unwrap();

        let result = delete(&dir, &outside);
        assert!(result.is_err(), "a path outside the folder must be refused");
        assert!(outside.exists(), "and the file must still be there");

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_non_mp4_is_refused() {
        let dir = temp_dir("ext");
        let path = write_clip(&dir, "important.txt", 10);
        assert!(delete(&dir, &path).is_err());
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_trim_is_written_beside_the_original() {
        let dir = temp_dir("trim-name");
        let source = write_clip(&dir, "1787099385_clip.mp4", 10);

        let destination = trimmed_destination(&dir, &source).unwrap();
        assert_eq!(
            destination.file_name().unwrap(),
            "1787099385_clip_trimmed.mp4"
        );
        assert!(source.exists(), "the original must be left alone");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_trim_does_not_overwrite_the_first() {
        let dir = temp_dir("trim-twice");
        let source = write_clip(&dir, "clip.mp4", 10);
        write_clip(&dir, "clip_trimmed.mp4", 10);

        let destination = trimmed_destination(&dir, &source).unwrap();
        assert_eq!(destination.file_name().unwrap(), "clip_trimmed2.mp4");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_suffix_does_not_pile_up() {
        let dir = temp_dir("trim-suffix");
        let already = write_clip(&dir, "clip_trimmed.mp4", 10);

        let destination = trimmed_destination(&dir, &already).unwrap();
        assert_eq!(destination.file_name().unwrap(), "clip_trimmed2.mp4");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_source_outside_the_clip_folder_is_refused() {
        let dir = temp_dir("trim-escape");
        let outside = std::env::temp_dir().join("nrc-not-a-clip-to-trim.mp4");
        std::fs::write(&outside, [0u8; 4]).unwrap();

        assert!(trimmed_destination(&dir, &outside).is_err());

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
