use super::policy::ScreenRect;
use std::mem::size_of;
use windows::Win32::Foundation::{BOOL, COLORREF, HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::{
    GetLayeredWindowAttributes, GetTopWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_HWNDNEXT, LAYERED_WINDOW_ATTRIBUTES_FLAGS, LWA_ALPHA, LWA_COLORKEY,
    WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

pub fn windows_above(own: isize) -> Vec<ScreenRect> {
    let own = HWND(own as _);
    let me = std::process::id();
    let mut covers = Vec::new();
    let mut current = unsafe { GetTopWindow(None) }.ok();
    while let Some(hwnd) = current {
        if hwnd == own {
            break;
        }
        if is_foreign_and_shown(hwnd, me) {
            if let Some(bounds) = bounds(hwnd) {
                covers.push(bounds);
            }
        }
        current = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
    }
    covers
}

fn is_foreign_and_shown(hwnd: HWND, me: u32) -> bool {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
        return false;
    }
    let mut owner = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
    owner != me && !is_cloaked(hwnd) && is_opaque(hwnd)
}

fn is_opaque(hwnd: HWND) -> bool {
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    if style & (WS_EX_TRANSPARENT.0 | WS_EX_TOOLWINDOW.0) != 0 {
        return false;
    }
    if style & WS_EX_LAYERED.0 == 0 {
        return true;
    }
    let mut key = COLORREF(0);
    let mut alpha = 0u8;
    let mut flags = LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
    let read = unsafe { GetLayeredWindowAttributes(hwnd, Some(&mut key), Some(&mut alpha), Some(&mut flags)) };
    read.is_ok() && flags.0 & LWA_COLORKEY.0 == 0 && (flags.0 & LWA_ALPHA.0 == 0 || alpha == 255)
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = BOOL(0);
    let read = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut BOOL).cast(),
            size_of::<BOOL>() as u32,
        )
    };
    read.is_ok() && cloaked.as_bool()
}

fn bounds(hwnd: HWND) -> Option<ScreenRect> {
    let mut rect = RECT::default();
    let framed = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut rect as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        )
    };
    if framed.is_err() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    (rect.right > rect.left && rect.bottom > rect.top).then_some(ScreenRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}
