use crate::utils::string_utils::safe_truncate;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const MAX_CRASH_AGE: Duration = Duration::from_secs(14 * 24 * 60 * 60);

const ALLOWED_SUFFIXES: &[&str] = &[".log", ".txt", ".json"];
const HEAD_SHARE_PERCENT: u64 = 40;
const MIN_READ_BUDGET: u64 = 4 * 1024;
const PREVIEW_FULL_MAX_BYTES: usize = 1024 * 1024;
const PREVIEW_EXCERPT_LINES: usize = 200;
const PREVIEW_EXCERPT_SIDE_MAX_BYTES: usize = 256 * 1024;

fn has_allowed_extension(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ALLOWED_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

pub type Redact = fn(&str) -> Result<String, String>;

pub fn resolve_safe_file(root: &Path, relative: &Path) -> Result<Option<PathBuf>, String> {
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("path is not a plain relative path".into());
    }
    let file_name = relative
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;
    if !has_allowed_extension(file_name) {
        return Err(format!("file type of '{}' is not allowed", file_name));
    }

    let canonical_root = match root.canonicalize() {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot resolve root: {}", e)),
    };
    let candidate = canonical_root.join(relative);

    let link_meta = match std::fs::symlink_metadata(&candidate) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("cannot stat file: {}", e)),
    };
    if link_meta.file_type().is_symlink() {
        return Err("symlinks are not allowed".into());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("cannot resolve file: {}", e))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("file is outside of the allowed directory".into());
    }
    if !std::fs::metadata(&canonical).is_ok_and(|m| m.is_file()) {
        return Err("not a regular file".into());
    }
    Ok(Some(canonical))
}

pub fn newest_matching(
    root: &Path,
    dir: &Path,
    accept: impl Fn(&str) -> bool,
    max_age: Option<Duration>,
) -> Option<PathBuf> {
    let now = SystemTime::now();
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(root.join(dir)).ok()?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|n| accept(n)) else {
            continue;
        };
        let Some(modified) = std::fs::symlink_metadata(entry.path())
            .ok()
            .filter(|m| m.is_file())
            .and_then(|m| m.modified().ok())
        else {
            continue;
        };
        if max_age.is_some_and(|max| now.duration_since(modified).unwrap_or_default() > max) {
            continue;
        }
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, dir.join(name)));
        }
    }
    best.map(|(_, p)| p)
}

fn take_bytes(file: &mut File, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(len as usize);
    file.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

fn lossy(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn read_window(path: &Path, max: u64, from_end: bool) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let total = file.metadata().ok()?.len();
    let len = max.min(total);
    let start = if from_end { total - len } else { 0 };
    take_bytes(&mut file, start, len).ok().map(lossy)
}

pub fn read_head_lossy(path: &Path, max: u64) -> Option<String> {
    read_window(path, max, false)
}

pub fn read_tail_lossy(path: &Path, max: u64) -> Option<String> {
    read_window(path, max, true)
}

fn floor_boundary(s: &str, idx: usize) -> usize {
    safe_truncate(s, idx).len()
}

fn ceil_boundary(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

fn truncation_marker(omitted: u64, total: u64, budget: u64) -> String {
    format!(
        "\n[... NoRisk Launcher: {} bytes omitted here (original size {} bytes, limit {} bytes) ...]\n",
        omitted, total, budget
    )
}

pub(crate) fn truncate_middle(text: &str, budget: u64) -> (String, bool) {
    let budget_usize = budget as usize;
    if text.len() <= budget_usize {
        return (text.to_string(), false);
    }
    let total = text.len() as u64;
    let marker_len = truncation_marker(total, total, budget).len() + 8;
    let usable = budget_usize.saturating_sub(marker_len);
    let head_len = usable * HEAD_SHARE_PERCENT as usize / 100;
    let tail_len = usable - head_len;

    let mut head_end = floor_boundary(text, head_len);
    if let Some(nl) = text[..head_end].rfind('\n') {
        head_end = nl + 1;
    }
    let mut tail_start = ceil_boundary(text, text.len() - tail_len);
    if let Some(nl) = text[tail_start..].find('\n') {
        tail_start += nl + 1;
    }
    tail_start = tail_start.max(head_end);
    let out = format!(
        "{}{}{}",
        &text[..head_end],
        truncation_marker((tail_start - head_end) as u64, total, budget),
        &text[tail_start..]
    );
    (out, true)
}

pub fn read_redacted(
    path: &Path,
    budget: u64,
    redact: Redact,
) -> Result<(String, bool), String> {
    let io_err = |e: std::io::Error| format!("cannot read file: {}", e);
    let budget = budget.max(MIN_READ_BUDGET);
    let mut file = File::open(path).map_err(io_err)?;
    let total = file.metadata().map_err(io_err)?.len();
    let raw_truncated = total > budget;

    let assembled = if !raw_truncated {
        lossy(take_bytes(&mut file, 0, total).map_err(io_err)?)
    } else {
        let head_len = budget * HEAD_SHARE_PERCENT / 100;
        let tail_len = budget - head_len;
        let head = lossy(take_bytes(&mut file, 0, head_len).map_err(io_err)?);
        let tail = lossy(take_bytes(&mut file, total - tail_len, tail_len).map_err(io_err)?);
        let head = head.rfind('\n').map_or(&head[..], |i| &head[..=i]);
        let tail = tail.find('\n').map_or(&tail[..], |i| &tail[i + 1..]);
        let omitted = total.saturating_sub((head.len() + tail.len()) as u64);
        format!(
            "{}{}{}",
            head,
            truncation_marker(omitted, total, budget),
            tail
        )
    };
    let redacted = redact(&assembled)?;
    drop(assembled);
    let (content, truncated_again) = truncate_middle(&redacted, budget);
    Ok((content, raw_truncated || truncated_again))
}

pub fn preview_excerpt(text: &str) -> (String, bool) {
    if text.len() <= PREVIEW_FULL_MAX_BYTES {
        return (text.to_string(), false);
    }

    let mut head_end = 0;
    for _ in 0..PREVIEW_EXCERPT_LINES {
        match text[head_end..].find('\n') {
            Some(n) => head_end += n + 1,
            None => {
                head_end = text.len();
                break;
            }
        }
    }
    head_end = floor_boundary(text, head_end.min(PREVIEW_EXCERPT_SIDE_MAX_BYTES));

    let mut tail_start = text.len();
    let mut cursor = text.trim_end_matches('\n').len();
    for _ in 0..PREVIEW_EXCERPT_LINES {
        match text[..cursor].rfind('\n') {
            Some(n) => {
                cursor = n;
                tail_start = n + 1;
            }
            None => {
                tail_start = 0;
                break;
            }
        }
    }
    tail_start = ceil_boundary(
        text,
        tail_start.max(text.len().saturating_sub(PREVIEW_EXCERPT_SIDE_MAX_BYTES)),
    )
    .max(head_end);

    (
        format!(
            "{}\n[… preview excerpt: {} bytes not shown here, but included in the upload …]\n\n{}",
            &text[..head_end],
            tail_start - head_end,
            &text[tail_start..]
        ),
        true,
    )
}
