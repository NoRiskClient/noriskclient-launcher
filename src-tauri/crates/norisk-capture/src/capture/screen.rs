use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

#[derive(Debug, Clone)]
pub struct Screen {
    pub monitor: HMONITOR,
    pub device: String,
    pub width: u32,
    pub height: u32,
    pub scale_percent: u32,
    pub primary: bool,
}

unsafe impl Send for Screen {}

pub fn screens() -> Vec<Screen> {
    unsafe extern "system" fn visit(monitor: HMONITOR, _: HDC, _: *mut RECT, found: LPARAM) -> BOOL {
        let found = &mut *(found.0 as *mut Vec<Screen>);

        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
            return true.into();
        }
        let area = info.monitorInfo.rcMonitor;
        let (mut dpi, mut unused) = (96u32, 96u32);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut unused);

        found.push(Screen {
            monitor,
            device: super::utf16_to_string(&info.szDevice),
            width: (area.right - area.left).max(0) as u32,
            height: (area.bottom - area.top).max(0) as u32,
            scale_percent: dpi * 100 / 96,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
        true.into()
    }

    let mut found: Vec<Screen> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(visit), LPARAM(&mut found as *mut _ as isize));
    }
    found
}

pub fn find(device: &str) -> Option<Screen> {
    screens()
        .into_iter()
        .find(|screen| screen.device.eq_ignore_ascii_case(device))
}
