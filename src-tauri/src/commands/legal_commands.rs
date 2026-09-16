use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::command;

type Result<T> = std::result::Result<T, CommandError>;

fn acceptance_file() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("legal_acceptance.json")
}

/// Accepted version per legal document. Empty when the file is missing or
/// unreadable, so the user is asked again rather than let through.
#[command]
pub async fn get_legal_acceptance() -> Result<HashMap<String, u32>> {
    match tokio::fs::read_to_string(acceptance_file()).await {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(AppError::Io(e).into()),
    }
}

#[command]
pub async fn set_legal_acceptance(versions: HashMap<String, u32>) -> Result<()> {
    let path = acceptance_file();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    }
    let json = serde_json::to_string_pretty(&versions).map_err(AppError::Json)?;
    tokio::fs::write(path, json).await.map_err(AppError::Io)?;
    Ok(())
}
