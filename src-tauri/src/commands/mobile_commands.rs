use crate::error::CommandError;
#[cfg(not(target_os = "android"))]
use crate::error::AppError;

/// PoC: install the Android JRE (if needed) and boot a JVM inside the app
/// process. Returns the JVM's java.version on success.
#[tauri::command]
pub async fn test_mobile_jvm(runtime_url: String) -> Result<String, CommandError> {
    #[cfg(target_os = "android")]
    {
        let runtime = crate::mobile::runtime::install_runtime(&runtime_url).await?;
        let version = tokio::task::spawn_blocking(move || {
            crate::mobile::jvm::boot_and_probe(runtime)
        })
        .await
        .map_err(|e| crate::error::AppError::Other(format!("JVM task failed: {}", e)))??;
        Ok(format!("JVM booted in-process, java.version={}", version))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = runtime_url;
        Err(CommandError::from(AppError::Other(
            "test_mobile_jvm is Android-only".to_string(),
        )))
    }
}
