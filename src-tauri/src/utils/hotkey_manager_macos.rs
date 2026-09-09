use crate::error::{AppError, Result};
use crate::state::config_state::ClipConfig;
use std::sync::Mutex;

static CURRENT: Mutex<Option<Vec<String>>> = Mutex::new(None);

pub fn apply(_app: &tauri::AppHandle, config: &ClipConfig) -> Result<Vec<String>> {
    let wanted = if config.enabled {
        vec![config.hotkey_save.clone(), config.hotkey_toggle.clone()]
    } else {
        Vec::new()
    };
    let mut current = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    if current.as_ref() != Some(&wanted) {
        if !norisk_capture::macos::hotkeys(&serde_json::to_string(&wanted)?, pressed) {
            *current = None;
            return Err(AppError::Other("Could not register clip hotkeys. Check the shortcuts and allow NoRiskClient in System Settings > Privacy & Security > Input Monitoring, then apply the settings again.".into()));
        }
        *current = Some(wanted.clone());
    }
    Ok(wanted.into_iter().filter(|key| !key.is_empty()).collect())
}

pub fn clear() {
    norisk_capture::macos::hotkeys("[]", pressed);
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

extern "C" fn pressed(tag: u8) {
    tauri::async_runtime::spawn(async move {
        let Ok(state) = crate::state::State::get().await else {
            return;
        };
        let clips = state.config_manager.get_config().await.clips;
        if !clips.enabled {
            return;
        }
        let request = match tag {
            0 => norisk_ipc::LauncherToCapture::SaveClip(norisk_ipc::SaveClipRequest {
                pre_roll_seconds: clips.pre_roll_seconds,
                post_roll_seconds: clips.post_roll_seconds,
                reason: norisk_ipc::ClipReason::Manual,
            }),
            1 => norisk_ipc::LauncherToCapture::SetBufferEnabled {
                enabled: !state.capture_supervisor.buffering_wanted(),
            },
            _ => return,
        };
        if let Err(error) = state.capture_supervisor.send(request) {
            log::warn!("Clip hotkey failed: {error}");
        }
    });
}
