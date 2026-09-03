use std::sync::Mutex;

use tauri::AppHandle;

use crate::error::{AppError, Result};
use crate::utils::hotkey_hook::Press;
use crate::state::config_state::ClipConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    SaveClip,
    ToggleBuffering,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Registration {
    enabled: bool,
    save: String,
    toggle: String,
    live: Vec<String>,
}

impl Registration {
    fn matches(&self, config: &ClipConfig) -> bool {
        self.enabled == config.enabled
            && self.save == config.hotkey_save
            && self.toggle == config.hotkey_toggle
    }
}

static CURRENT: Mutex<Option<Registration>> = Mutex::new(None);

pub fn apply(app: &AppHandle, config: &ClipConfig) -> Result<Vec<String>> {
    let mut current = CURRENT.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(existing) = current.as_ref() {
        if existing.matches(config) {
            log::debug!("Hotkeys unchanged; leaving them registered");
            return Ok(existing.live.clone());
        }
    }

    *current = None;

    crate::utils::hotkey_hook::uninstall();

    if !config.enabled {
        log::debug!("Clip system disabled; no hotkeys registered");
        *current = Some(Registration {
            enabled: false,
            save: config.hotkey_save.clone(),
            toggle: config.hotkey_toggle.clone(),
            live: Vec::new(),
        });
        return Ok(Vec::new());
    }

    let wanted = [
        (config.hotkey_save.as_str(), Action::SaveClip),
        (config.hotkey_toggle.as_str(), Action::ToggleBuffering),
    ];

    let mut problems = Vec::new();
    let mut registered = Vec::new();
    let mut hooked = Vec::new();

    for (binding, action) in wanted {
        if binding.trim().is_empty() {
            continue;
        }

        match crate::utils::hotkey_hook::Binding::parse(binding) {
            Some(parsed) => {
                log::info!("Watching {binding} for {action:?}");
                hooked.push((parsed, action_tag(action)));
                registered.push(binding.to_string());
            }
            None => problems.push(format!("'{binding}' is not a key this can watch for")),
        }
    }

    if !hooked.is_empty() {
        let (events, presses) = std::sync::mpsc::channel::<Press>();

        if let Err(e) = crate::utils::hotkey_hook::install(hooked, events) {
            problems.push(format!("{e}"));
        } else {
            let handle = app.clone();
            std::thread::Builder::new()
                .name("nrc-hotkey-dispatch".into())
                .spawn(move || {
                    while let Ok(press) = presses.recv() {
                        let tag = match press {
                            Press::Fired(tag) => tag,
                            Press::Ignored {
                                key,
                                ctrl,
                                shift,
                                alt,
                            } => {
                                log::debug!(
                                    "Hotkey key {key:#04x} seen but ignored (ctrl: {ctrl}, shift: {shift}, alt: {alt})"
                                );
                                continue;
                            }
                        };
                        let Some(action) = action_from_tag(tag) else {
                            continue;
                        };
                        if !accept_press(action) {
                            continue;
                        }
                        let handle = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            dispatch(&handle, action).await;
                        });
                    }
                })
                .ok();
        }
    }

    if !problems.is_empty() {
        return Err(AppError::Other(problems.join("; ")));
    }

    *current = Some(Registration {
        enabled: true,
        save: config.hotkey_save.clone(),
        toggle: config.hotkey_toggle.clone(),
        live: registered.clone(),
    });

    Ok(registered)
}

pub fn clear() {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = None;

    crate::utils::hotkey_hook::uninstall();
}

async fn dispatch(app: &AppHandle, action: Action) {
    let _ = app;

    let state = match crate::state::State::get().await {
        Ok(state) => state,
        Err(e) => {
            log::error!("Hotkey fired before the launcher was ready: {e}");
            return;
        }
    };

    let clips = state.config_manager.get_config().await.clips;

    match action {
        Action::SaveClip => {
            let request = norisk_ipc::LauncherToCapture::SaveClip(norisk_ipc::SaveClipRequest {
                pre_roll_seconds: clips.pre_roll_seconds,
                post_roll_seconds: clips.post_roll_seconds,
                reason: norisk_ipc::ClipReason::Manual,
            });
            match state.capture_supervisor.send(request) {
                Ok(()) => log::info!("Clip requested by hotkey"),
                Err(e) => log::warn!("Clip hotkey went nowhere: {e}"),
            }
        }
        Action::ToggleBuffering => {
            let paused = state.capture_supervisor.state().await == norisk_ipc::CaptureState::Paused;
            let request = norisk_ipc::LauncherToCapture::SetBufferEnabled { enabled: paused };
            match state.capture_supervisor.send(request) {
                Ok(()) => log::info!("Buffering {}", if paused { "resumed" } else { "paused" }),
                Err(e) => log::warn!("Buffer toggle went nowhere: {e}"),
            }
        }
    }
}

fn accept_press(action: Action) -> bool {
    use std::time::{Duration, Instant};

    const MIN_GAP: Duration = Duration::from_millis(400);

    static LAST: Mutex<Option<(Action, Instant)>> = Mutex::new(None);

    let mut last = LAST.lock().unwrap_or_else(|poison| poison.into_inner());
    let now = Instant::now();

    if let Some((previous, when)) = *last {
        if previous == action && now.duration_since(when) < MIN_GAP {
            return false;
        }
    }
    *last = Some((action, now));
    true
}

fn action_tag(action: Action) -> u8 {
    match action {
        Action::SaveClip => 0,
        Action::ToggleBuffering => 1,
    }
}

fn action_from_tag(tag: u8) -> Option<Action> {
    match tag {
        0 => Some(Action::SaveClip),
        1 => Some(Action::ToggleBuffering),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::utils::hotkey_hook::Binding;

    #[test]
    fn the_default_bindings_parse() {
        let config = ClipConfig::default();
        assert!(
            Binding::parse(&config.hotkey_save).is_some(),
            "default save hotkey '{}' does not parse",
            config.hotkey_save
        );
        assert!(
            Binding::parse(&config.hotkey_toggle).is_some(),
            "default toggle hotkey '{}' does not parse",
            config.hotkey_toggle
        );
    }

    #[test]
    fn nonsense_bindings_are_rejected_rather_than_ignored() {
        assert!(Binding::parse("").is_none());
        assert!(Binding::parse("NotAKey").is_none());
    }

    #[test]
    fn modifier_combinations_parse() {
        for binding in ["F8", "Shift+F8", "Ctrl+Alt+F9", "Ctrl+Shift+KeyC", "Super+F9"] {
            assert!(
                Binding::parse(binding).is_some(),
                "'{binding}' should be a binding the hook can watch for"
            );
        }
    }

    #[test]
    fn tauri_style_bindings_are_not_silently_accepted() {
        assert_eq!(
            Binding::parse("CommandOrControl+Shift+C"),
            None,
            "a bare letter is not a code the hook knows"
        );
    }

    fn registration_for(config: &ClipConfig) -> Registration {
        Registration {
            enabled: config.enabled,
            save: config.hotkey_save.clone(),
            toggle: config.hotkey_toggle.clone(),
            live: vec![config.hotkey_save.clone()],
        }
    }

    #[test]
    fn unchanged_bindings_are_recognised() {
        let config = ClipConfig {
            enabled: true,
            ..ClipConfig::default()
        };
        assert!(registration_for(&config).matches(&config));

        let elsewhere = ClipConfig {
            bitrate_kbps: 50_000,
            pre_roll_seconds: 60,
            capture_audio: false,
            ..config.clone()
        };
        assert!(registration_for(&config).matches(&elsewhere));
    }

    #[test]
    fn a_changed_key_is_not_mistaken_for_the_old_one() {
        let config = ClipConfig {
            enabled: true,
            ..ClipConfig::default()
        };
        let existing = registration_for(&config);

        for changed in [
            ClipConfig {
                hotkey_save: "F9".into(),
                ..config.clone()
            },
            ClipConfig {
                hotkey_toggle: "Ctrl+F8".into(),
                ..config.clone()
            },
            ClipConfig {
                enabled: false,
                ..config.clone()
            },
        ] {
            assert!(
                !existing.matches(&changed),
                "{changed:?} should not count as unchanged"
            );
        }
    }
}
