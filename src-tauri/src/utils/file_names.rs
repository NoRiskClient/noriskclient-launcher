use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

pub const MAX_NAME: usize = 80;

pub fn sanitise_name(name: &str) -> Result<String> {
    let name = name.trim().trim_end_matches('.').trim();

    if name.is_empty() {
        return Err(AppError::Other("a name is required".into()));
    }
    if name.chars().count() > MAX_NAME {
        return Err(AppError::Other(format!(
            "that name is longer than {MAX_NAME} characters"
        )));
    }
    if let Some(bad) = name.chars().find(|c| {
        matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control()
    }) {
        return Err(AppError::Other(match bad.is_control() {
            true => "a name cannot contain control characters".into(),
            false => format!("a name cannot contain {bad}"),
        }));
    }

    let stem = name.split('.').next().unwrap_or(name);
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return Err(AppError::Other(format!(
            "{name} is a name Windows reserves"
        )));
    }

    Ok(name.to_string())
}

pub fn rename_beside(root: &Path, path: &Path, name: &str) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::Other(format!("the folder is unreadable: {e}")))?;
    let source = path
        .canonicalize()
        .map_err(|e| AppError::Other(format!("that file no longer exists: {e}")))?;
    if !source.starts_with(&root) || !source.is_file() {
        return Err(AppError::Other(
            "refusing to rename a file outside its folder".into(),
        ));
    }
    let name = sanitise_name(name)?;
    let file_name = match source.extension().and_then(|e| e.to_str()) {
        Some(extension) => format!("{name}.{extension}"),
        None => name,
    };
    let parent = source
        .parent()
        .ok_or_else(|| AppError::Other("that file has no folder".into()))?;
    let destination = parent.join(&file_name);
    if destination == source {
        return Ok(plain(destination));
    }
    let only_case_changes = source
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|current| current.eq_ignore_ascii_case(&file_name))
        && destination.canonicalize().is_ok_and(|same| same == source);
    if destination.exists() && !only_case_changes {
        return Err(AppError::Other(
            "a file with that name already exists".into(),
        ));
    }
    std::fs::rename(&source, &destination)
        .map_err(|e| AppError::Other(format!("could not rename {}: {e}", source.display())))?;
    Ok(plain(destination))
}

pub fn plain(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    match text.strip_prefix("\\\\?\\") {
        Some(rest) => match rest.strip_prefix("UNC\\") {
            Some(share) => PathBuf::from(format!("\\\\{share}")),
            None => PathBuf::from(rest),
        },
        None => path,
    }
}
