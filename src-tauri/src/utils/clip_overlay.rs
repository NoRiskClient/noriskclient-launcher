use tauri::{AppHandle, Manager};
#[cfg(any(windows, target_os = "macos"))]
use tauri::{WebviewUrl, WebviewWindowBuilder};

use crate::error::Result;

pub const OVERLAY_LABEL: &str = "clip-overlay";

#[cfg(any(windows, target_os = "macos"))]
const WIDTH: f64 = 340.0;
#[cfg(any(windows, target_os = "macos"))]
const HEIGHT: f64 = 96.0;

const MARGIN: f64 = 24.0;

const TOP_MARGIN: f64 = 110.0;

#[cfg(not(any(windows, target_os = "macos")))]
pub fn create(_app: &AppHandle) -> Result<()> {
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
pub fn create(app: &AppHandle) -> Result<()> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html?overlay=clip".into()),
    )
    .title("NoRiskClient Clip")
    .inner_size(WIDTH, HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()?;

    #[cfg(target_os = "macos")]
    {
        window.set_ignore_cursor_events(true)?;
        window.set_visible_on_all_workspaces(true)?;
    }

    position(&window);

    #[cfg(windows)]
    make_click_through(&window);

    log::info!("Clip overlay ready");
    Ok(())
}

fn position(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let origin = monitor.position().to_logical::<f64>(scale);

    let x = origin.x + MARGIN;
    let y = origin.y + TOP_MARGIN;

    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

#[cfg(windows)]
fn make_click_through(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TRANSPARENT,
    };

    let Ok(handle) = window.hwnd() else {
        log::warn!("Clip overlay has no window handle; it may swallow clicks");
        return;
    };

    unsafe {
        let hwnd = HWND(handle.0);
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted =
            current | (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0 | WS_EX_NOACTIVATE.0) as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
    }
}

pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        log::warn!("Asked to show the clip overlay, but the window does not exist");
        return;
    };
    log::debug!("Showing the clip overlay");

    position(&window);

    #[cfg(not(windows))]
    let _ = window.show();

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
        };

        match window.hwnd() {
            Ok(handle) => unsafe {
                let hwnd = HWND(handle.0);
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            },
            Err(e) => {
                log::warn!("The clip overlay has no window handle, showing it may steal focus: {e}");
                let _ = window.show();
            }
        }
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
}
