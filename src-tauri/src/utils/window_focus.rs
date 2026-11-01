pub fn bring_to_front<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    window.show()?;
    window.unminimize()?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_always_on_top(false);
    window.set_focus()
}
