use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ScreenInfo {
    pub device: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[cfg(windows)]
pub fn list() -> Vec<ScreenInfo> {
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    };
    use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

    unsafe extern "system" fn visit(monitor: HMONITOR, _: HDC, _: *mut RECT, found: LPARAM) -> BOOL {
        let found = &mut *(found.0 as *mut Vec<ScreenInfo>);

        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            return true.into();
        }
        let area = info.monitorInfo.rcMonitor;
        let end = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());

        found.push(ScreenInfo {
            device: String::from_utf16_lossy(&info.szDevice[..end]),
            width: (area.right - area.left).max(0) as u32,
            height: (area.bottom - area.top).max(0) as u32,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
        true.into()
    }

    let mut found: Vec<ScreenInfo> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(visit), LPARAM(&mut found as *mut _ as isize));
    }
    found.sort_by_key(|screen| (!screen.primary, screen.device.clone()));
    found
}

#[cfg(not(windows))]
pub fn list() -> Vec<ScreenInfo> {
    Vec::new()
}
