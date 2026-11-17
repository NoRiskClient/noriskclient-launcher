use tauri::{AppHandle, CloseRequestApi, Emitter, Manager, Runtime, Window};

pub const LABEL: &str = "main";

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window(LABEL) {
        Some(window) => {
            if let Err(e) = crate::utils::window_focus::bring_to_front(&window) {
                log::error!("Failed to bring the main window to the front: {e}");
            }
        }
        None => log::info!("Main window not available yet; nothing to show"),
    }
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        log::warn!("Main window not available; nothing to toggle");
        return;
    };
    let in_front = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if !in_front {
        show(app);
    } else if let Err(e) = window.hide() {
        log::error!("Failed to hide the main window: {e}");
    }
}

pub fn close_requested<R: Runtime>(window: &Window<R>, api: &CloseRequestApi) {
    if window.label() != LABEL {
        return;
    }
    api.prevent_close();
    if !crate::state::config_state::closes_to_tray() {
        quit(window.app_handle());
    } else if let Err(e) = window.hide() {
        log::error!("Failed to hide the main window on close: {e}");
    }
}

pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    if app.get_webview_window(crate::commands::clip_commands::EDITOR_LABEL).is_some()
        && app.emit_to(LABEL, "quit_requested", ()).is_ok()
    {
        return;
    }
    app.exit(0);
}
