
pub fn leave(code: i32) -> ! {
    log::logger().flush();
    std::process::exit(code)
}

#[cfg(windows)]
pub fn watch_parent(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    let handle = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(handle) => handle,
        Err(e) => {
            log::warn!("Cannot watch the launcher (pid {pid}): {e}");
            return;
        }
    };

    struct Owned(windows::Win32::Foundation::HANDLE);
    unsafe impl Send for Owned {}

    let handle = Owned(handle);

    let watcher = std::thread::Builder::new()
        .name("nrc-parent-watch".into())
        .spawn(move || {
            let handle = handle;
            unsafe { WaitForSingleObject(handle.0, INFINITE) };
            log::warn!("The launcher (pid {pid}) is gone; stopping rather than holding its devices");
            let _ = unsafe { CloseHandle(handle.0) };
            leave(0);
        });

    match watcher {
        Ok(_) => log::info!("Watching the launcher (pid {pid})"),
        Err(e) => log::warn!("Could not start the launcher watchdog: {e}"),
    }
}

#[cfg(not(windows))]
pub fn watch_parent(_pid: u32) {}
