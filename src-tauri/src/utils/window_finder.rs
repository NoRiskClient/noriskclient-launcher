#[cfg(windows)]
pub fn find_running_game() -> Option<u32> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    };

    struct Search {
        best: Option<(u32, i64)>,
    }

    unsafe extern "system" fn visit(window: HWND, param: LPARAM) -> BOOL {
        let search = &mut *(param.0 as *mut Search);

        if !IsWindowVisible(window).as_bool() {
            return TRUE;
        }

        let mut class = [0u16; 64];
        let written = GetClassNameW(window, &mut class);
        if written <= 0 {
            return TRUE;
        }
        let class = String::from_utf16_lossy(&class[..written as usize]);
        if !class.eq_ignore_ascii_case("GLFW30") {
            return TRUE;
        }

        let mut rect = RECT::default();
        if GetWindowRect(window, &mut rect).is_err() {
            return TRUE;
        }
        let area = (rect.right - rect.left).max(0) as i64 * (rect.bottom - rect.top).max(0) as i64;

        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == 0 {
            return TRUE;
        }

        if search.best.is_none_or(|(_, best)| area > best) {
            search.best = Some((pid, area));
        }

        TRUE
    }

    let mut search = Search { best: None };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }

    search.best.map(|(pid, _)| pid)
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn find_running_game() -> Option<u32> {
    None
}

#[cfg(target_os = "macos")]
pub fn find_running_game() -> Option<u32> {
    crate::utils::game_detect::open_apps().into_iter().find(|app| {
        app.name.to_lowercase().contains("minecraft")
            || (std::path::Path::new(&app.executable).file_name().is_some_and(|name| name == "java")
                && minecraft_process(app.pid))
    }).map(|app| app.pid)
}

#[cfg(target_os = "macos")]
fn minecraft_process(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always));
    system.process(Pid::from_u32(pid)).is_some_and(|process| {
        process.cmd().iter().any(|arg| {
            let arg = arg.to_string_lossy();
            arg.contains("net.minecraft") || arg.contains("net.fabricmc.loader")
                || arg.contains("org.quiltmc.loader") || arg.contains("cpw.mods.bootstraplauncher")
                || arg.contains("net.neoforged")
        })
    })
}
