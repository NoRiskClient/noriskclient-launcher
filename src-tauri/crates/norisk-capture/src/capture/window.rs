use std::time::{Duration, Instant};

use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, GW_OWNER,
};

const GLFW_CLASS: &str = "GLFW30";

#[derive(Debug, Clone)]
pub struct GameWindow {
    pub hwnd: HWND,
    pub pid: u32,
    pub title: String,
    pub class: String,
    pub width: i32,
    pub height: i32,
}

impl GameWindow {
    fn score(&self) -> i64 {
        let mut score = 0i64;
        if self.class.eq_ignore_ascii_case(GLFW_CLASS) {
            score += 1_000_000;
        }
        score + (self.width as i64 * self.height as i64)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowState {
    pub alive: bool,
    pub minimized: bool,
    pub foreground: bool,
}

impl WindowState {
    pub fn should_produce_frames(&self) -> bool {
        self.alive && !self.minimized && self.foreground
    }
}

pub fn pid_of(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

pub fn state_of(hwnd: HWND) -> WindowState {
    unsafe {
        let alive = IsWindow(hwnd).as_bool();
        WindowState {
            alive,
            minimized: alive && IsIconic(hwnd).as_bool(),
            foreground: alive && GetForegroundWindow() == hwnd,
        }
    }
}

pub fn find_by_pid(pid: u32) -> Option<GameWindow> {
    enumerate()
        .into_iter()
        .filter(|w| w.pid == pid)
        .max_by_key(GameWindow::score)
}

const FALLBACK_PATIENCE: Duration = Duration::from_secs(5);

pub struct WindowSearch {
    pid: u32,
    deadline: Instant,
    fallback: Option<(GameWindow, Instant)>,
    patient: bool,
}

fn runs_java(pid: u32) -> bool {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return true;
        };

        let mut buffer = [0u16; 260];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(handle);
        if ok.is_err() {
            return true;
        }

        let path = String::from_utf16_lossy(&buffer[..length as usize]).to_lowercase();
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(path);

        name == "javaw.exe" || name == "java.exe"
    }
}

pub enum SearchStep {
    Found(GameWindow),
    Waiting,
    TimedOut,
}

impl WindowSearch {
    pub fn new(pid: u32, timeout: Duration) -> Self {
        let patient = runs_java(pid);
        if !patient {
            log::debug!("Process {pid} is not Java; taking its window straight away");
        }
        Self {
            pid,
            deadline: Instant::now() + timeout,
            fallback: None,
            patient,
        }
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn poll(&mut self) -> SearchStep {
        if let Some(window) = find_by_pid(self.pid) {
            if window.class.eq_ignore_ascii_case(GLFW_CLASS) {
                return SearchStep::Found(window);
            }

            if !self.patient {
                return SearchStep::Found(window);
            }

            match &self.fallback {
                Some((seen, since))
                    if seen.hwnd == window.hwnd && since.elapsed() >= FALLBACK_PATIENCE =>
                {
                    log::debug!(
                        "No GLFW window for process {}; settling for '{}'",
                        self.pid,
                        window.title
                    );
                    return SearchStep::Found(window);
                }
                Some((seen, _)) if seen.hwnd == window.hwnd => {}
                _ => self.fallback = Some((window, Instant::now())),
            }
        }

        if Instant::now() >= self.deadline {
            return match self.fallback.take() {
                Some((window, _)) => SearchStep::Found(window),
                None => SearchStep::TimedOut,
            };
        }

        SearchStep::Waiting
    }
}

pub fn enumerate() -> Vec<GameWindow> {
    let mut handles: Vec<HWND> = Vec::with_capacity(256);
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut _ as isize));
    }

    handles.into_iter().filter_map(describe).collect()
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<HWND>);
    out.push(hwnd);
    TRUE
}

fn describe(hwnd: HWND) -> Option<GameWindow> {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return None;
        }
        if IsIconic(hwnd).as_bool() {
            return None;
        }
        if GetWindow(hwnd, GW_OWNER)
            .map(|owner| !owner.0.is_null())
            .unwrap_or(false)
        {
            return None;
        }

        let mut title_buffer = [0u16; 512];
        if GetWindowTextW(hwnd, &mut title_buffer) == 0 {
            return None;
        }

        let mut class_buffer = [0u16; 256];
        GetClassNameW(hwnd, &mut class_buffer);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }

        Some(GameWindow {
            hwnd,
            pid,
            title: utf16_to_string(&title_buffer),
            class: utf16_to_string(&class_buffer),
            width,
            height,
        })
    }
}

fn utf16_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

pub fn client_size(hwnd: HWND) -> Option<(u32, u32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    unsafe {
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client).ok()?;

        let width = (client.right - client.left).max(0) as u32;
        let height = (client.bottom - client.top).max(0) as u32;
        (width > 0 && height > 0).then_some((width, height))
    }
}

pub fn content_rect(hwnd: HWND, captured: (u32, u32)) -> Option<(i32, i32, u32, u32)> {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    unsafe {
        let mut frame = RECT::default();
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut frame as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
        .ok()?;

        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client).ok()?;

        let mut origin = POINT { x: 0, y: 0 };
        if !ClientToScreen(hwnd, &mut origin).as_bool() {
            return None;
        }

        let width = (client.right - client.left).max(0) as u32;
        let height = (client.bottom - client.top).max(0) as u32;
        if width == 0 || height == 0 {
            return None;
        }

        let mut left = origin.x - frame.left;
        let mut top = origin.y - frame.top;
        let mut width = width;
        let mut height = height;

        const BLEED: i32 = 2;

        if top > 0 {
            top += BLEED;
            height = height.saturating_sub(BLEED as u32);
        }
        if left > 0 {
            left += BLEED;
            width = width.saturating_sub(BLEED as u32);
        }
        if (left + width as i32) < captured.0 as i32 {
            width = width.saturating_sub(BLEED as u32);
        }
        if (top + height as i32) < captured.1 as i32 {
            height = height.saturating_sub(BLEED as u32);
        }

        if width == 0 || height == 0 {
            return None;
        }

        if left <= 0 && top <= 0 && width >= captured.0 && height >= captured.1 {
            return None;
        }

        if left < 0
            || top < 0
            || left as u32 + width > captured.0
            || top as u32 + height > captured.1
        {
            log::debug!(
                "Content area {width}x{height}+{left}+{top} does not fit the captured \
                 {}x{} surface; recording the whole window",
                captured.0,
                captured.1
            );
            return None;
        }

        Some((left, top, width, height))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_only_expected_from_a_live_foreground_window() {
        let ready = WindowState {
            alive: true,
            minimized: false,
            foreground: true,
        };
        assert!(ready.should_produce_frames());

        assert!(!WindowState { minimized: true, ..ready }.should_produce_frames());
        assert!(!WindowState { foreground: false, ..ready }.should_produce_frames());
        assert!(!WindowState { alive: false, ..ready }.should_produce_frames());
    }
}
