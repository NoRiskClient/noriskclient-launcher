use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::http_client::nrc_get;
use flate2::read::GzDecoder;
use log::info;
use std::path::PathBuf;

/// Directory that holds the extracted Android JRE (…/meta/android_runtime/jre21).
pub fn runtime_dir() -> PathBuf {
    LAUNCHER_DIRECTORY
        .meta_dir()
        .join("android_runtime")
        .join("jre21")
}

pub fn is_runtime_installed() -> bool {
    runtime_dir().join("lib/server/libjvm.so").is_file()
}

/// Installs a jre tarball (tar.gz with a top-level `jre21/` folder) into the
/// runtime directory. `source` is either an http(s) URL or a local file path
/// (dev workflow: adb-pushed tarball).
pub async fn install_runtime(source: &str) -> Result<PathBuf> {
    let target = runtime_dir();
    if is_runtime_installed() {
        info!("[MobileRuntime] Runtime already installed at {:?}", target);
        return Ok(target);
    }

    let bytes: Vec<u8> = if source.starts_with("http") {
        info!("[MobileRuntime] Downloading runtime from {}", source);
        let response = nrc_get(source).send("Android JRE download").await?;
        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "Runtime download failed with status {}",
                response.status()
            )));
        }
        response
            .bytes()
            .await
            .map_err(|e| AppError::Other(format!("Runtime download read failed: {}", e)))?
            .to_vec()
    } else {
        info!("[MobileRuntime] Reading runtime tarball from {}", source);
        tokio::fs::read(source)
            .await
            .map_err(|e| AppError::Other(format!("Runtime file read failed: {}", e)))?
    };
    info!("[MobileRuntime] Got {} MB", bytes.len() / 1024 / 1024);

    let parent = target
        .parent()
        .ok_or_else(|| AppError::Other("Runtime dir has no parent".to_string()))?
        .to_path_buf();

    tokio::task::spawn_blocking(move || -> Result<()> {
        std::fs::create_dir_all(&parent)
            .map_err(|e| AppError::Other(format!("Failed to create runtime dir: {}", e)))?;
        let decoder = GzDecoder::new(std::io::Cursor::new(&bytes[..]));
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(&parent)
            .map_err(|e| AppError::Other(format!("Runtime extraction failed: {}", e)))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("Runtime extraction task failed: {}", e)))??;

    if !is_runtime_installed() {
        return Err(AppError::Other(
            "Runtime extracted but libjvm.so missing".to_string(),
        ));
    }
    info!("[MobileRuntime] Runtime installed at {:?}", target);
    Ok(target)
}
