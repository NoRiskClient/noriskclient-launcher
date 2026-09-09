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

#[cfg(not(windows))]
pub fn find_running_game() -> Option<u32> {
    None
}
