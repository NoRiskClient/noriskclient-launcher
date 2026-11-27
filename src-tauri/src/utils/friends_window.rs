use crate::error::{AppError, Result};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Listed in the default capability.
pub const LABEL: &str = "friends";

/// Two quick clicks must not both build a window.
static OPENING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Opens the friends window, or brings it to the front when it is already open.
pub async fn open(app: &AppHandle) -> Result<()> {
    let _opening = OPENING.lock().await;

    if let Some(window) = app.get_window(LABEL) {
        crate::utils::window_focus::bring_to_front(&window)
            .map_err(|e| AppError::Other(format!("Failed to bring the friends window to front: {e}")))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("friends-window.html".into()))
        .title("Friends")
        // Wide enough for the rail (the page drops it below 1180px).
        .inner_size(1240.0, 720.0)
        .min_inner_size(760.0, 520.0)
        .decorations(false)
        .center()
        .visible(false)
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                crate::ads::host_page_reloaded(webview.app_handle(), LABEL);
            }
        })
        .build()
        .map_err(|e| AppError::Other(format!("Failed to open the friends window: {e}")))?;

    Ok(())
}
