use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipEntry {
    pub path: PathBuf,
    pub name: String,
    pub size_bytes: u64,
    pub created_at: i64,
    pub duration_seconds: Option<f32>,
    pub game: Option<String>,
    pub thumbnail: Option<PathBuf>,
    pub favourite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub used_bytes: u64,
    /// `0` when no limit is set.
    pub limit_bytes: u64,
    pub clip_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDetails {
    pub duration_seconds: f32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub peak_step_ms: u32,
    pub audio_tracks: Vec<ClipAudioTrack>,
    #[serde(default)]
    pub game: Option<String>,
    #[serde(default)]
    pub favourite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudioTrack {
    pub label: String,
    pub stream: u32,
    pub adjustable: bool,
    pub peaks: Vec<u8>,
}

impl From<&norisk_ipc::ClipManifest> for ClipDetails {
    fn from(manifest: &norisk_ipc::ClipManifest) -> Self {
        Self {
            duration_seconds: manifest.duration_seconds,
            width: manifest.width,
            height: manifest.height,
            fps: manifest.fps,
            peak_step_ms: norisk_ipc::PEAK_STEP_MS,
            game: None,
            favourite: false,
            audio_tracks: manifest
                .audio_tracks
                .iter()
                .map(|track| ClipAudioTrack {
                    label: track.label.clone(),
                    stream: track.stream,
                    adjustable: track.adjustable,
                    peaks: track.peaks.clone(),
                })
                .collect(),
        }
    }
}

impl ClipDetails {
    pub fn sliced(&self, start_seconds: f64, end_seconds: f64) -> Self {
        let step = self.peak_step_ms.max(1) as f64 / 1_000.0;
        let from = (start_seconds.max(0.0) / step).floor() as usize;
        let to = (end_seconds.max(0.0) / step).ceil() as usize;

        let mut merged: Vec<u8> = Vec::new();
        for track in &self.audio_tracks {
            if self.audio_tracks.len() > 1 && !track.adjustable {
                continue;
            }
            let slice = track.peaks.get(from..to.min(track.peaks.len())).unwrap_or(&[]);
            if merged.len() < slice.len() {
                merged.resize(slice.len(), 0);
            }
            for (into, value) in merged.iter_mut().zip(slice) {
                *into = (*into).max(*value);
            }
        }

        Self {
            duration_seconds: (end_seconds - start_seconds).max(0.0) as f32,
            width: self.width,
            height: self.height,
            fps: self.fps,
            peak_step_ms: self.peak_step_ms,
            game: self.game.clone(),
            favourite: self.favourite,
            audio_tracks: if merged.is_empty() {
                Vec::new()
            } else {
                vec![ClipAudioTrack {
                    label: "Mix".to_string(),
                    stream: 0,
                    adjustable: false,
                    peaks: merged,
                }]
            },
        }
    }
}

fn plain(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    match text.strip_prefix("\\\\?\\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

pub fn meta_dir() -> PathBuf {
    #[cfg(test)]
    {
        return std::env::temp_dir().join("nrc-clip-meta-test");
    }

    #[cfg(not(test))]
    LAUNCHER_DIRECTORY.root_dir().join("clip-meta")
}

fn meta_name(clip: &Path) -> String {
    let stem = clip
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "clip".to_string());

    format!("{stem}-{:08x}", fingerprint(clip))
}

fn fingerprint(clip: &Path) -> u32 {
    let flattened = plain(clip.to_path_buf());
    let text = flattened.to_string_lossy().to_lowercase();

    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (hash ^ (hash >> 32)) as u32
}

fn meta_path(clip: &Path, extension: &str) -> PathBuf {
    meta_dir().join(format!("{}.{extension}", meta_name(clip)))
}

pub fn thumbnail_path(clip: &Path) -> PathBuf {
    meta_path(clip, "thumb.jpg")
}

pub fn write_thumbnail(dir: &Path, clip: &Path, jpeg: &[u8]) -> Result<PathBuf> {
    let clip = guard_inside(dir, clip)?;

    if jpeg.len() > MAX_THUMBNAIL_BYTES {
        return Err(AppError::Other(format!(
            "that still is {} KB, which is more than a thumbnail should ever be",
            jpeg.len() / 1024
        )));
    }
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return Err(AppError::Other("that is not a JPEG".into()));
    }

    ensure_meta_dir()?;
    let path = thumbnail_path(&clip);
    std::fs::write(&path, jpeg)
        .map_err(|e| AppError::Other(format!("could not write {}: {e}", path.display())))?;
    Ok(plain(path))
}

const MAX_THUMBNAIL_BYTES: usize = 2 * 1024 * 1024;

pub fn details_path(clip: &Path) -> PathBuf {
    meta_path(clip, "nrc.json")
}

pub fn tidy_clip_folder(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut moved = 0;
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".nrc.json") && !name.ends_with(".thumb.jpg") {
            continue;
        }

        let (stem, extension) = match name.strip_suffix(".nrc.json") {
            Some(stem) => (stem, "nrc.json"),
            None => (name.trim_end_matches(".thumb.jpg"), "thumb.jpg"),
        };
        let target = meta_path(&dir.join(format!("{stem}.mp4")), extension);

        if std::fs::create_dir_all(meta_dir()).is_err() {
            return;
        }
        let done = if target.exists() {
            std::fs::remove_file(&path).is_ok()
        } else {
            std::fs::rename(&path, &target).is_ok()
        };
        if done {
            moved += 1;
        }
    }

    if moved > 0 {
        log::info!("Moved {moved} leftover file(s) out of the clip folder");
    }
}

pub fn write_details(clip: &Path, details: &ClipDetails) -> Result<()> {
    let path = details_path(clip);
    ensure_meta_dir()?;
    let json = serde_json::to_vec(details)
        .map_err(|e| AppError::Other(format!("could not describe {}: {e}", clip.display())))?;
    std::fs::write(&path, json)
        .map_err(|e| AppError::Other(format!("could not write {}: {e}", path.display())))
}

fn ensure_meta_dir() -> Result<()> {
    let dir = meta_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Other(format!("could not create {}: {e}", dir.display())))
}

pub fn read_details(clip: &Path) -> Option<ClipDetails> {
    let path = details_path(clip);
    let bytes = std::fs::read(&path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(details) => Some(details),
        Err(e) => {
            log::warn!("Ignoring an unreadable {}: {e}", path.display());
            None
        }
    }
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
            let details = read_details(&path);
            Some(ClipEntry {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                size_bytes: metadata.len(),
                created_at: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
                duration_seconds: details
                    .as_ref()
                    .map(|d| d.duration_seconds)
                    .filter(|seconds| *seconds > 0.0),
                favourite: details.as_ref().is_some_and(|d| d.favourite),
                game: details.as_ref().and_then(|d| d.game.clone()),
                thumbnail: Some(thumbnail_path(&path)).filter(|thumb| thumb.exists()),
                path,
            })
        })
        .collect();

    clips.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(clips)
}

pub fn guard_inside(dir: &Path, path: &Path) -> Result<PathBuf> {
    let dir = dir
        .canonicalize()
        .map_err(|e| AppError::Other(format!("clip folder is unreadable: {e}")))?;
    let path = path
        .canonicalize()
        .map_err(|e| AppError::Other(format!("that clip no longer exists: {e}")))?;

    if !path.starts_with(&dir) {
        return Err(AppError::Other(
            "refusing to touch a file outside the clip folder".into(),
        ));
    }
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        != Some("mp4".into())
    {
        return Err(AppError::Other("that is not a clip".into()));
    }

    Ok(path)
}

pub fn delete(dir: &Path, path: &Path) -> Result<()> {
    let path = guard_inside(dir, path)?;

    std::fs::remove_file(&path)
        .map_err(|e| AppError::Other(format!("could not delete {}: {e}", path.display())))?;

    forget_details(&path);
    Ok(())
}

pub fn forget_details(clip: &Path) {
    for path in [details_path(clip), thumbnail_path(clip)] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("Could not remove {}: {e}", path.display()),
        }
    }
}

pub fn set_favourite(dir: &Path, path: &Path, favourite: bool) -> Result<()> {
    let path = guard_inside(dir, path)?;
    let mut details = read_details(&path).unwrap_or_default();
    if details.favourite == favourite {
        return Ok(());
    }
    details.favourite = favourite;
    write_details(&path, &details)
}

const MAX_NAME: usize = 80;

fn sanitise_name(name: &str) -> Result<String> {
    let name = name.trim().trim_end_matches('.').trim();

    if name.is_empty() {
        return Err(AppError::Other("a clip needs a name".into()));
    }
    if name.chars().count() > MAX_NAME {
        return Err(AppError::Other(format!(
            "that name is longer than {MAX_NAME} characters"
        )));
    }
    if let Some(bad) = name
        .chars()
        .find(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control())
    {
        return Err(AppError::Other(match bad.is_control() {
            true => "a name cannot contain control characters".into(),
            false => format!("a name cannot contain {bad}"),
        }));
    }

    let stem = name.split('.').next().unwrap_or(name);
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return Err(AppError::Other(format!("{name} is a name Windows reserves")));
    }

    Ok(name.to_string())
}

pub fn rename(dir: &Path, path: &Path, name: &str) -> Result<PathBuf> {
    let source = guard_inside(dir, path)?;
    let dir = dir
        .canonicalize()
        .map_err(|e| AppError::Other(format!("clip folder is unreadable: {e}")))?;

    let name = sanitise_name(name)?;
    let destination = dir.join(format!("{name}.mp4"));

    if destination == source {
        return Ok(plain(source));
    }
    if destination.exists() {
        return Err(AppError::Other(format!("a clip called {name} already exists")));
    }

    std::fs::rename(&source, &destination).map_err(|e| {
        AppError::Other(format!("could not rename {}: {e}", source.display()))
    })?;

    for beside in [details_path, thumbnail_path] {
        let from = beside(&source);
        if !from.exists() {
            continue;
        }
        if let Err(e) = std::fs::rename(&from, beside(&destination)) {
            log::warn!("Renamed the clip but not {}: {e}", from.display());
        }
    }

    Ok(plain(destination))
}

pub fn usage(dir: &Path, limit_gb: u32) -> Result<StorageUsage> {
    let clips = list(dir)?;
    Ok(StorageUsage {
        used_bytes: clips.iter().map(|c| c.size_bytes).sum(),
        limit_bytes: limit_gb as u64 * 1024 * 1024 * 1024,
        clip_count: clips.len(),
    })
}

#[derive(Debug, Default, PartialEq)]
struct Cleanup {
    remove: Vec<PathBuf>,
    spared: usize,
    over_by: u64,
}

fn cleanup_plan(clips: &[ClipEntry], limit: u64) -> Cleanup {
    let mut total: u64 = clips.iter().map(|c| c.size_bytes).sum();
    if total <= limit {
        return Cleanup::default();
    }

    let mut plan = Cleanup::default();
    for clip in clips.iter().rev() {
        if total <= limit {
            break;
        }
        if clip.favourite {
            plan.spared += 1;
            continue;
        }
        total -= clip.size_bytes.min(total);
        plan.remove.push(clip.path.clone());
    }

    plan.over_by = total.saturating_sub(limit);
    plan
}

pub fn enforce_limit(dir: &Path, limit_gb: u32) -> Result<Vec<PathBuf>> {
    if limit_gb == 0 {
        return Ok(Vec::new());
    }
    let limit = limit_gb as u64 * 1024 * 1024 * 1024;

    let plan = cleanup_plan(&list(dir)?, limit);
    let mut removed = Vec::new();

    for path in plan.remove {
        match std::fs::remove_file(&path) {
            Ok(()) => {
                forget_details(&path);
                removed.push(path);
            }
            Err(e) => {
                log::warn!(
                    "Could not delete {} while enforcing the storage limit: {e}",
                    path.display()
                );
            }
        }
    }

    if !removed.is_empty() {
        log::info!(
            "Storage limit of {limit_gb} GB reached: deleted {} old clip(s)",
            removed.len()
        );
    }
    if plan.over_by > 0 {
        log::warn!(
            "Still {} MB over the {limit_gb} GB limit with {} clip(s) marked to keep",
            plan.over_by / 1024 / 1024,
            plan.spared,
        );
    }
    Ok(removed)
}

pub fn vertical_destination(dir: &Path, source: &Path) -> Result<PathBuf> {
    beside(dir, source, "_vertical")
}

pub fn trimmed_destination(dir: &Path, source: &Path) -> Result<PathBuf> {
    beside(dir, source, "_trimmed")
}

fn beside(dir: &Path, source: &Path, suffix: &str) -> Result<PathBuf> {
    let source = guard_inside(dir, source)?;
    let dir = dir
        .canonicalize()
        .map_err(|e| AppError::Other(format!("clip folder is unreadable: {e}")))?;

    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Other("that clip has no usable name".into()))?;

    let base = stem.rsplit_once(suffix).map_or(stem, |(head, _)| head);

    for attempt in 0..1000 {
        let name = if attempt == 0 {
            format!("{base}{suffix}.mp4")
        } else {
            format!("{base}{suffix}{}.mp4", attempt + 1)
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return Ok(plain(candidate));
        }
    }

    Err(AppError::Other(format!(
        "there are already a thousand {} versions of this clip",
        suffix.trim_start_matches('_'),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    mod paths {
        use super::*;

        #[test]
        fn the_extended_length_prefix_is_removed() {
            assert_eq!(
                plain(PathBuf::from(r"\\?\C:\clips\one.mp4")),
                PathBuf::from(r"C:\clips\one.mp4"),
            );
        }

        #[test]
        fn an_ordinary_path_is_left_alone() {
            let ordinary = PathBuf::from(r"C:\clips\one.mp4");
            assert_eq!(plain(ordinary.clone()), ordinary);
        }

        #[test]
        fn a_network_path_is_left_alone() {
            let unc = PathBuf::from(r"\\?\UNC\server\share\one.mp4");
            assert_eq!(plain(unc.clone()), unc);
        }
    }

    mod naming {
        use super::*;

        #[test]
        fn an_ordinary_name_is_kept_exactly() {
            assert_eq!(sanitise_name("insane clutch").unwrap(), "insane clutch");
            assert_eq!(sanitise_name("  bed rush  ").unwrap(), "bed rush");
        }

        #[test]
        fn names_people_actually_type_are_allowed() {
            for name in ["1v5 ace!", "clip #3", "wtf... how", "Räuber & Gendarm", "近距離"] {
                assert!(sanitise_name(name).is_ok(), "{name} should be allowed");
            }
        }

        #[test]
        fn an_empty_name_is_refused() {
            assert!(sanitise_name("").is_err());
            assert!(sanitise_name("   ").is_err());
            assert!(sanitise_name("...").is_err());
        }

        #[test]
        fn characters_windows_cannot_store_are_refused() {
            for name in ["a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b"] {
                assert!(sanitise_name(name).is_err(), "{name} should be refused");
            }
            assert!(sanitise_name("line\nbreak").is_err());
        }

        #[test]
        fn a_path_cannot_be_smuggled_in_as_a_name() {
            assert!(sanitise_name("../../Windows/System32/evil").is_err());
            assert!(sanitise_name("..").is_err());
        }

        #[test]
        fn device_names_are_refused_however_they_are_written() {
            for name in ["CON", "con", "NUL", "com1", "LPT9", "aux.mp4"] {
                assert!(sanitise_name(name).is_err(), "{name} should be refused");
            }
            assert!(sanitise_name("console wars").is_ok());
        }

        #[test]
        fn a_name_longer_than_the_limit_is_refused() {
            assert!(sanitise_name(&"a".repeat(MAX_NAME)).is_ok());
            assert!(sanitise_name(&"a".repeat(MAX_NAME + 1)).is_err());
        }

        #[test]
        fn a_trailing_dot_is_dropped_because_windows_drops_it_anyway() {
            assert_eq!(sanitise_name("clip.").unwrap(), "clip");
        }
    }

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

    fn details_with(tracks: Vec<ClipAudioTrack>) -> ClipDetails {
        ClipDetails {
            duration_seconds: 10.0,
            width: 1920,
            height: 1080,
            fps: 60,
            peak_step_ms: 20,
            audio_tracks: tracks,
            game: None,
            favourite: false,
        }
    }

    fn track(label: &str, adjustable: bool, peaks: Vec<u8>) -> ClipAudioTrack {
        ClipAudioTrack {
            label: label.to_string(),
            stream: 0,
            adjustable,
            peaks,
        }
    }

    #[test]
    fn a_clip_with_no_sidecar_simply_has_none() {
        let dir = temp_dir("no-sidecar");
        let clip = write_clip(&dir, "a.mp4", 10);
        assert!(read_details(&clip).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn details_survive_a_round_trip() {
        let dir = temp_dir("sidecar-round-trip");
        let clip = write_clip(&dir, "a.mp4", 10);

        let details = details_with(vec![
            track("Mix", false, vec![10, 20, 30]),
            track("Microphone", true, vec![0, 200, 0]),
        ]);
        write_details(&clip, &details).unwrap();

        let read = read_details(&clip).expect("the sidecar was just written");
        assert_eq!(read.audio_tracks.len(), 2);
        assert_eq!(read.audio_tracks[1].label, "Microphone");
        assert_eq!(read.audio_tracks[1].peaks, vec![0, 200, 0]);
        assert!(read.audio_tracks[1].adjustable);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_sidecar_is_ignored_rather_than_fatal() {
        let dir = temp_dir("sidecar-damaged");
        let clip = write_clip(&dir, "a.mp4", 10);
        std::fs::create_dir_all(meta_dir()).unwrap();
        std::fs::write(details_path(&clip), b"{ this is not json").unwrap();

        assert!(
            read_details(&clip).is_none(),
            "a clip must still open when only its description is broken"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_clip_takes_its_sidecar_with_it() {
        let dir = temp_dir("sidecar-delete");
        let clip = write_clip(&dir, "a.mp4", 10);
        write_details(&clip, &details_with(Vec::new())).unwrap();
        let sidecar = details_path(&clip);
        assert!(sidecar.exists());

        delete(&dir, &clip).unwrap();

        assert!(
            !sidecar.exists(),
            "a stray sidecar would later be handed to whatever clip took the same name"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn slicing_keeps_only_the_range_that_was_kept() {
        let details = details_with(vec![track("Mix", false, (0..200u32).map(|i| i as u8).collect())]);

        let cut = details.sliced(1.0, 2.0);

        assert_eq!(cut.audio_tracks.len(), 1);
        assert_eq!(cut.audio_tracks[0].peaks.len(), 50);
        assert_eq!(cut.audio_tracks[0].peaks[0], 50, "starts where the trim did");
        assert!((cut.duration_seconds - 1.0).abs() < 1e-6);
    }

    #[test]
    fn slicing_collapses_the_sources_into_one_lane() {
        let details = details_with(vec![
            track("Mix", false, vec![255, 255, 255, 255]),
            track("Game", true, vec![10, 90, 10, 10]),
            track("Microphone", true, vec![0, 0, 200, 0]),
        ]);

        let cut = details.sliced(0.0, 0.08);
        let peaks = &cut.audio_tracks[0].peaks;

        assert_eq!(cut.audio_tracks.len(), 1, "a trimmed clip has one track");
        assert!(!cut.audio_tracks[0].adjustable, "its balance is already baked in");
        assert_eq!(peaks[1], 90, "the game was the loudest thing here");
        assert_eq!(peaks[2], 200, "the microphone was the loudest thing here");
    }

    #[test]
    fn slicing_a_clip_that_only_ever_had_a_mix_keeps_it() {
        let details = details_with(vec![track("Mix", false, vec![10, 20, 30, 40])]);
        let cut = details.sliced(0.0, 0.08);
        assert_eq!(cut.audio_tracks[0].peaks, vec![10, 20, 30, 40]);
    }

    #[test]
    fn slicing_past_the_end_does_not_panic() {
        let details = details_with(vec![track("Mix", false, vec![1, 2, 3])]);
        assert!(details.sliced(90.0, 120.0).audio_tracks.is_empty());
        assert_eq!(details.sliced(0.0, 900.0).audio_tracks[0].peaks.len(), 3);
    }

    #[test]
    fn slicing_a_silent_clip_gives_no_lanes() {
        assert!(details_with(Vec::new()).sliced(0.0, 5.0).audio_tracks.is_empty());
    }

    #[test]
    fn a_path_outside_the_clip_folder_is_refused() {
        let dir = temp_dir("guard-inside");
        let outside = std::env::temp_dir().join("nrc-guard-inside-outside.mp4");
        std::fs::write(&outside, b"x").unwrap();

        assert!(guard_inside(&dir, &outside).is_err());

        let inside = write_clip(&dir, "a.mp4", 10);
        assert!(guard_inside(&dir, &inside).is_ok());

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_that_is_not_a_clip_is_refused() {
        let dir = temp_dir("guard-extension");
        let text = write_clip(&dir, "notes.txt", 10);
        assert!(guard_inside(&dir, &text).is_err());
        let _ = std::fs::remove_dir_all(&dir);
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

    fn entry(name: &str, size_bytes: u64, created_at: i64, favourite: bool) -> ClipEntry {
        ClipEntry {
            path: format!("{name}.mp4").into(),
            name: name.into(),
            size_bytes,
            created_at,
            duration_seconds: None,
            game: None,
            thumbnail: None,
            favourite,
        }
    }

    #[allow(clippy::vec_init_then_push)]
    fn library() -> Vec<ClipEntry> {
        vec![
            entry("new", 40, 300, false),
            entry("mid", 40, 200, false),
            entry("old", 40, 100, false),
        ]
    }

    #[test]
    fn cleanup_takes_the_oldest_until_it_fits() {
        let plan = cleanup_plan(&library(), 100);

        assert_eq!(
            plan.remove,
            vec![PathBuf::from("old.mp4")],
            "the oldest goes first, and only as many as needed",
        );
        assert_eq!(plan.over_by, 0);
        assert_eq!(plan.spared, 0);
    }

    #[test]
    fn cleanup_keeps_going_until_it_actually_fits() {
        let plan = cleanup_plan(&library(), 45);
        assert_eq!(
            plan.remove,
            vec![PathBuf::from("old.mp4"), PathBuf::from("mid.mp4")],
        );
        assert_eq!(plan.over_by, 0);
    }

    #[test]
    fn cleanup_does_nothing_when_there_is_room() {
        assert_eq!(cleanup_plan(&library(), 1000), Cleanup::default());
    }

    #[test]
    fn cleanup_steps_over_a_marked_clip_and_takes_the_next() {
        let mut clips = library();
        clips[2].favourite = true; // the oldest, exactly what would have gone

        let plan = cleanup_plan(&clips, 100);

        assert_eq!(
            plan.remove,
            vec![PathBuf::from("mid.mp4")],
            "the marked clip must be passed over, not deleted",
        );
        assert_eq!(plan.spared, 1);
        assert_eq!(plan.over_by, 0);
    }

    #[test]
    fn cleanup_would_rather_stay_over_the_limit_than_take_a_marked_clip() {
        let clips: Vec<ClipEntry> = library()
            .into_iter()
            .map(|mut clip| {
                clip.favourite = true;
                clip
            })
            .collect();

        let plan = cleanup_plan(&clips, 40);

        assert!(plan.remove.is_empty(), "nothing marked may be deleted");
        assert_eq!(plan.spared, 3);
        assert_eq!(plan.over_by, 80, "and the caller is told how far over it is");
    }

    fn jpeg() -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend_from_slice(&[0u8; 64]);
        bytes
    }

    #[test]
    fn the_same_clip_is_filed_the_same_way_however_its_path_is_written() {
        let dir = temp_dir("meta-key");
        let clip = write_clip(&dir, "same.mp4", 8);
        let canonical = clip.canonicalize().unwrap();

        assert_ne!(clip, canonical, "the test needs the two forms to differ");
        assert_eq!(details_path(&clip), details_path(&canonical));
        assert_eq!(thumbnail_path(&clip), thumbnail_path(&canonical));
    }

    #[test]
    fn two_clips_of_the_same_name_in_different_folders_do_not_share() {
        let one = temp_dir("meta-a").join("clip.mp4");
        let two = temp_dir("meta-b").join("clip.mp4");

        assert_ne!(details_path(&one), details_path(&two));
    }

    #[test]
    fn a_still_is_written_beside_its_clip() {
        let dir = temp_dir("thumb");
        let clip = write_clip(&dir, "thumb-written.mp4", 32);

        let written = write_thumbnail(&dir, &clip, &jpeg()).unwrap();

        assert_eq!(written.parent().unwrap(), meta_dir(), "stills belong out of the clip folder");
        assert_eq!(written, thumbnail_path(&clip));
        assert!(
            written
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("thumb-written-"),
            "got {}",
            written.display(),
        );
        assert!(written.exists());
        assert_eq!(list(&dir).unwrap()[0].thumbnail, Some(written));
    }

    #[test]
    fn a_clip_without_a_still_reports_none() {
        let dir = temp_dir("thumb-none");
        write_clip(&dir, "thumb-absent.mp4", 32);

        assert_eq!(list(&dir).unwrap()[0].thumbnail, None);
    }

    #[test]
    fn something_that_is_not_a_jpeg_is_refused() {
        let dir = temp_dir("thumb-bogus");
        let clip = write_clip(&dir, "thumb-bogus.mp4", 32);

        assert!(write_thumbnail(&dir, &clip, b"<html>nope</html>").is_err());
        assert!(!thumbnail_path(&clip).exists());
    }

    #[test]
    fn an_enormous_still_is_refused() {
        let dir = temp_dir("thumb-huge");
        let clip = write_clip(&dir, "thumb-huge.mp4", 32);

        let mut huge = jpeg();
        huge.resize(MAX_THUMBNAIL_BYTES + 1, 0);
        assert!(write_thumbnail(&dir, &clip, &huge).is_err());
    }

    #[test]
    fn a_still_cannot_be_written_outside_the_clip_folder() {
        let dir = temp_dir("thumb-escape");
        let outside = temp_dir("thumb-escape-target");
        let stranger = write_clip(&outside, "stranger.mp4", 16);

        assert!(write_thumbnail(&dir, &stranger, &jpeg()).is_err());
    }

    #[test]
    fn deleting_a_clip_takes_its_still_with_it() {
        let dir = temp_dir("thumb-delete");
        let clip = write_clip(&dir, "thumb-deleted.mp4", 32);
        write_thumbnail(&dir, &clip, &jpeg()).unwrap();

        delete(&dir, &clip).unwrap();

        assert!(!thumbnail_path(&clip).exists(), "a still for a clip that is gone");
    }

    #[test]
    fn a_still_travels_with_a_renamed_clip() {
        let dir = temp_dir("thumb-rename");
        let clip = write_clip(&dir, "1787_clip.mp4", 32);
        write_thumbnail(&dir, &clip, &jpeg()).unwrap();

        let renamed = rename(&dir, &clip, "keeper").unwrap();

        assert!(thumbnail_path(&renamed).exists(), "the still stayed behind");
        assert!(!thumbnail_path(&clip).exists());
        assert!(list(&dir).unwrap()[0].thumbnail.is_some());
    }

    #[test]
    fn renaming_moves_the_clip_and_its_sidecar() {
        let dir = temp_dir("rename");
        let clip = write_clip(&dir, "1787_clip.mp4", 32);
        write_details(&clip, &details_with(vec![track("Mix", false, vec![1, 2, 3])])).unwrap();

        let renamed = rename(&dir, &clip, "insane clutch").unwrap();

        assert_eq!(renamed, dir.join("insane clutch.mp4"));
        assert!(renamed.exists(), "the clip should be at its new name");
        assert!(!clip.exists(), "and gone from the old one");
        assert!(
            read_details(&renamed).is_some(),
            "the sidecar should have come along",
        );
        assert!(!details_path(&clip).exists(), "and not been left behind");
    }

    #[test]
    fn renaming_a_clip_without_a_sidecar_is_fine() {
        let dir = temp_dir("rename-bare");
        let clip = write_clip(&dir, "1787_clip.mp4", 32);

        let renamed = rename(&dir, &clip, "no sidecar").unwrap();
        assert!(renamed.exists());
        assert!(read_details(&renamed).is_none());
    }

    #[test]
    fn renaming_onto_an_existing_clip_is_refused() {
        let dir = temp_dir("rename-clash");
        let clip = write_clip(&dir, "one.mp4", 32);
        write_clip(&dir, "two.mp4", 64);

        assert!(rename(&dir, &clip, "two").is_err());
        assert!(clip.exists(), "the clip must survive a refused rename");
        assert_eq!(
            std::fs::read(dir.join("two.mp4")).unwrap().len(),
            64,
            "and must not have overwritten the other one",
        );
    }

    #[test]
    fn renaming_a_clip_to_its_own_name_is_a_no_op() {
        let dir = temp_dir("rename-same");
        let clip = write_clip(&dir, "keeper.mp4", 32);

        assert_eq!(rename(&dir, &clip, "keeper").unwrap(), clip);
        assert!(clip.exists());
    }

    #[test]
    fn renaming_outside_the_clip_folder_is_refused() {
        let dir = temp_dir("rename-escape");
        let outside = temp_dir("rename-escape-target");
        let stranger = write_clip(&outside, "stranger.mp4", 16);

        assert!(rename(&dir, &stranger, "mine").is_err());
        assert!(stranger.exists());
    }

    #[test]
    fn marking_a_clip_survives_a_round_trip() {
        let dir = temp_dir("favourite");
        let clip = write_clip(&dir, "mark-roundtrip.mp4", 32);

        set_favourite(&dir, &clip, true).unwrap();
        assert!(list(&dir).unwrap()[0].favourite);

        set_favourite(&dir, &clip, false).unwrap();
        assert!(!list(&dir).unwrap()[0].favourite);
    }

    #[test]
    fn marking_a_clip_that_has_details_keeps_them() {
        let dir = temp_dir("favourite-details");
        let clip = write_clip(&dir, "mark-keeps.mp4", 32);
        write_details(&clip, &details_with(vec![track("Mix", false, vec![9])])).unwrap();

        set_favourite(&dir, &clip, true).unwrap();

        let details = read_details(&clip).unwrap();
        assert!(details.favourite);
        assert_eq!(details.duration_seconds, 10.0, "the length must not be lost");
        assert_eq!(details.audio_tracks.len(), 1, "nor the waveforms");
    }

    #[test]
    fn a_mark_travels_with_a_renamed_clip() {
        let dir = temp_dir("favourite-rename");
        let clip = write_clip(&dir, "1787_clip.mp4", 32);
        set_favourite(&dir, &clip, true).unwrap();

        let renamed = rename(&dir, &clip, "keeper").unwrap();
        assert!(read_details(&renamed).unwrap().favourite);
    }

    #[test]
    fn a_length_of_zero_is_reported_as_no_length() {
        let dir = temp_dir("favourite-only-sidecar");
        let clip = write_clip(&dir, "old.mp4", 32);

        set_favourite(&dir, &clip, true).unwrap();

        assert_eq!(list(&dir).unwrap()[0].duration_seconds, None);
    }

    #[test]
    fn a_length_is_reported_when_the_sidecar_has_one() {
        let dir = temp_dir("length");
        let clip = write_clip(&dir, "length-known.mp4", 32);
        write_details(&clip, &details_with(Vec::new())).unwrap();

        assert_eq!(list(&dir).unwrap()[0].duration_seconds, Some(10.0));
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
