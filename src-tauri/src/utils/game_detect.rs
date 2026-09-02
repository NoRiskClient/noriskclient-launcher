
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenApp {
    pub pid: u32,
    pub executable: String,
    pub name: String,
}

const SHELL_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow",
    "ForegroundStaging",
    "XamlExplorerHostIslandWindow",
    "MultitaskingViewFrame",
    "TaskListThumbnailWnd",
];

const NOT_PROGRAMS: &[&str] = &[
    "explorer.exe",
    "searchhost.exe",
    "searchapp.exe",
    "startmenuexperiencehost.exe",
    "shellexperiencehost.exe",
    "applicationframehost.exe",
    "textinputhost.exe",
    "lockapp.exe",
    "systemsettings.exe",
    "dwm.exe",
    "sihost.exe",
    "widgets.exe",
    "widgetservice.exe",
    "phoneexperiencehost.exe",
];

#[cfg(not(windows))]
pub fn open_apps() -> Vec<OpenApp> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn foreground_app() -> Option<OpenApp> {
    None
}

#[cfg(windows)]
pub fn open_apps() -> Vec<OpenApp> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, IsWindowVisible,
    };

    struct Found {
        apps: Vec<(OpenApp, i64)>,
    }

    unsafe extern "system" fn visit(window: HWND, param: LPARAM) -> BOOL {
        let found = &mut *(param.0 as *mut Found);

        if !IsWindowVisible(window).as_bool() || GetWindowTextLengthW(window) == 0 {
            return TRUE;
        }

        let Some(app) = describe(window) else {
            return TRUE;
        };

        let mut rect = RECT::default();
        let area = if GetWindowRect(window, &mut rect).is_ok() {
            (rect.right - rect.left).max(0) as i64 * (rect.bottom - rect.top).max(0) as i64
        } else {
            0
        };

        match found
            .apps
            .iter_mut()
            .find(|(seen, _)| seen.executable == app.executable)
        {
            Some((seen, best)) if area > *best => {
                *seen = app;
                *best = area;
            }
            Some(_) => {}
            None => found.apps.push((app, area)),
        }

        TRUE
    }

    let mut found = Found { apps: Vec::new() };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut found as *mut Found as isize));
    }

    found.apps.sort_by(|(_, a), (_, b)| b.cmp(a));
    found.apps.into_iter().map(|(app, _)| app).collect()
}

#[cfg(windows)]
pub fn foreground_app() -> Option<OpenApp> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindowVisible};

    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() || !IsWindowVisible(window).as_bool() {
            return None;
        }
        describe(window)
    }
}

#[cfg(windows)]
unsafe fn describe(window: windows::Win32::Foundation::HWND) -> Option<OpenApp> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowTextW, GetWindowThreadProcessId,
    };

    let mut class = [0u16; 128];
    let written = GetClassNameW(window, &mut class);
    let class = String::from_utf16_lossy(&class[..written.max(0) as usize]);
    if SHELL_CLASSES.iter().any(|shell| class == *shell) {
        return None;
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid == 0 || pid == std::process::id() {
        return None;
    }

    let executable = executable_of(pid)?;
    if NOT_PROGRAMS.contains(&executable.as_str()) {
        return None;
    }

    let mut title = [0u16; 256];
    let written = GetWindowTextW(window, &mut title);
    let title = String::from_utf16_lossy(&title[..written.max(0) as usize]);

    Some(OpenApp {
        pid,
        name: display_name(&title, &executable),
        executable,
    })
}

#[cfg(windows)]
fn executable_of(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buffer = [0u16; 260];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(handle);
        ok.ok()?;

        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        Some(
            std::path::Path::new(&path)
                .file_name()?
                .to_string_lossy()
                .to_lowercase(),
        )
    }
}

fn display_name(title: &str, executable: &str) -> String {
    let title = title.trim();

    let mut trimmed = title;
    for separator in [" - ", " — ", " | ", "|", "—"] {
        trimmed = trimmed.split(separator).next().unwrap_or(trimmed);
    }
    let trimmed = trimmed.trim();

    let name = if trimmed.len() >= 2 { trimmed } else { title };

    if name.len() >= 2 {
        return name.chars().take(60).collect();
    }

    executable
        .strip_suffix(".exe")
        .unwrap_or(executable)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "reports what is on screen; run it by hand"]
    #[cfg(windows)]
    fn probe_open_apps() {
        for app in open_apps() {
            println!("pid {:<8} {:<28} {}", app.pid, app.executable, app.name);
        }
    }

    #[test]
    fn a_plain_title_is_kept() {
        assert_eq!(
            display_name("Rocket League", "rocketleague.exe"),
            "Rocket League"
        );
    }

    #[test]
    fn what_follows_a_separator_is_dropped() {
        assert_eq!(
            display_name("Deep Rock Galactic — Hazard 4", "fsd.exe"),
            "Deep Rock Galactic",
        );
        assert_eq!(
            display_name("Minecraft 1.21 - Singleplayer", "javaw.exe"),
            "Minecraft 1.21",
        );
    }

    #[test]
    fn a_hyphen_inside_a_name_is_left_alone() {
        assert_eq!(
            display_name("Counter-Strike 2 | de_dust2 | 12-4", "cs2.exe"),
            "Counter-Strike 2",
        );
        assert_eq!(display_name("Half-Life 2", "hl2.exe"), "Half-Life 2");
    }

    #[test]
    fn a_title_that_is_only_noise_falls_back_to_the_executable() {
        assert_eq!(display_name("", "rocketleague.exe"), "rocketleague");
        assert_eq!(display_name("  ", "fsd.exe"), "fsd");
    }

    #[test]
    fn a_title_starting_with_a_separator_keeps_the_whole_thing() {
        assert_eq!(display_name("- Untitled", "thing.exe"), "- Untitled");
    }

    #[test]
    fn a_very_long_title_is_cut_to_something_a_row_can_show() {
        let long = "A".repeat(200);
        assert_eq!(display_name(&long, "game.exe").chars().count(), 60);
    }

    #[test]
    fn the_desktop_itself_is_not_a_program() {
        for shell in ["Progman", "WorkerW", "Shell_TrayWnd"] {
            assert!(SHELL_CLASSES.contains(&shell), "{shell} should be skipped");
        }
    }

    #[test]
    fn the_filter_list_is_lowercase_because_that_is_what_it_is_matched_against() {
        for program in NOT_PROGRAMS {
            assert_eq!(
                *program,
                program.to_lowercase(),
                "{program} would never match"
            );
        }
    }
}
