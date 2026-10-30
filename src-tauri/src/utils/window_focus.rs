pub fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;

    match app.get_webview_window("main") {
        Some(window) => {
            if let Err(e) = bring_to_front(&window) {
                log::error!("Failed to bring the main window to the front: {e}");
            }
        }
        None => log::info!("Main window not available yet; nothing to show"),
    }
}

pub fn bring_to_front<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    window.show()?;
    window.unminimize()?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_always_on_top(false);
    window.set_focus()
}
