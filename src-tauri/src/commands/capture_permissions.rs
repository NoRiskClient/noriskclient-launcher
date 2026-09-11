use crate::error::{AppError, CommandError, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapturePermission {
    ScreenRecording,
    Microphone,
    InputMonitoring,
}

#[derive(Deserialize, Serialize)]
pub struct CapturePermissions {
    pub screen_recording: bool,
    pub microphone: bool,
    #[serde(skip_deserializing)]
    pub input_monitoring: bool,
}

#[tauri::command]
pub async fn capture_permissions(
    request: Option<CapturePermission>,
) -> std::result::Result<Option<CapturePermissions>, CommandError> {
    Ok(read_permissions(request).await?)
}

pub async fn read_permissions(
    request: Option<CapturePermission>,
) -> Result<Option<CapturePermissions>> {
    #[cfg(target_os = "macos")]
    {
        if !norisk_capture::macos::capture_supported() {
            return Ok(None);
        }
        let engine = crate::utils::capture_runtime::ensure_engine().await?;
        let mut command = tokio::process::Command::new(engine);
        command.arg("--permissions").kill_on_drop(true);
        match request {
            Some(CapturePermission::ScreenRecording) => {
                command.args(["--request-permission", "screen_recording"]);
            }
            Some(CapturePermission::Microphone) => {
                command.args(["--request-permission", "microphone"]);
            }
            _ => {}
        }
        let output = command.output().await?;
        if !output.status.success() {
            return Err(AppError::Other(
                "Could not check macOS capture permissions.".into(),
            ));
        }
        let mut permissions: CapturePermissions = serde_json::from_slice(&output.stdout)?;
        permissions.input_monitoring = norisk_capture::macos::input_monitoring(matches!(
            request,
            Some(CapturePermission::InputMonitoring)
        ));
        Ok(Some(permissions))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Ok(None)
    }
}

#[tauri::command]
pub fn capture_open_permission_settings(
    permission: CapturePermission,
) -> std::result::Result<(), CommandError> {
    #[cfg(target_os = "macos")]
    {
        let kind = match permission {
            CapturePermission::ScreenRecording => 0,
            CapturePermission::Microphone => 1,
            CapturePermission::InputMonitoring => 2,
        };
        if !norisk_capture::macos::open_permission_settings(kind) {
            return Err(AppError::Other("Could not open macOS privacy settings.".into()).into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = permission;
    Ok(())
}
