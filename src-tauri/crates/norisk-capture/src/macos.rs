use std::ffi::{c_char, c_void, CStr, CString};

use crate::audio::denoise::Denoiser;

const FONT: &[u8] = include_bytes!("../../../../public/fonts/smallcaps.ttf");

extern "C" {
    fn nrc_capture_supported() -> bool;
    fn nrc_input_monitoring(request: bool) -> bool;
    fn nrc_open_permission_settings(permission: u8) -> bool;
    fn nrc_capture_main(logger: extern "C" fn(*const c_char));
    fn nrc_set_overlay_font(bytes: *const u8, length: usize);
    fn nrc_set_denoiser(
        new: extern "C" fn(u16) -> *mut c_void,
        process: extern "C" fn(*mut c_void, *mut f32, usize),
        free: extern "C" fn(*mut c_void),
    );
    fn nrc_open_apps(foreground: bool) -> *mut c_char;
    fn nrc_screens() -> *mut c_char;
    fn nrc_free_string(value: *mut c_char);
    fn nrc_hotkeys(bindings: *const c_char, callback: extern "C" fn(u8)) -> i32;
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(dir) = args
        .iter()
        .position(|arg| arg == "--log-dir")
        .and_then(|i| args.get(i + 1))
    {
        let setup = norisk_logging::LogSetup::new(dir, "capture.log").console(false);
        if let Err(error) = norisk_logging::init(setup) {
            eprintln!("Could not set up capture logging: {error}");
        }
    }
    unsafe {
        nrc_set_overlay_font(FONT.as_ptr(), FONT.len());
        nrc_set_denoiser(denoiser_new, denoiser_process, denoiser_free);
        nrc_capture_main(log_native)
    }
}

pub fn open_apps(foreground: bool) -> String {
    unsafe { take_json(nrc_open_apps(foreground)) }
}

pub fn screens() -> String {
    unsafe { take_json(nrc_screens()) }
}

unsafe fn take_json(ptr: *mut c_char) -> String {
    if ptr.is_null() {
        return "[]".into();
    }
    let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
    nrc_free_string(ptr);
    value
}

#[derive(Debug, PartialEq, Eq)]
pub enum HotkeyError {
    InvalidShortcut,
    PermissionDenied,
    TapUnavailable,
}

pub fn hotkeys(bindings: &str, callback: extern "C" fn(u8)) -> Result<(), HotkeyError> {
    let bindings = CString::new(bindings).map_err(|_| HotkeyError::InvalidShortcut)?;
    match unsafe { nrc_hotkeys(bindings.as_ptr(), callback) } {
        0 => Ok(()),
        1 => Err(HotkeyError::InvalidShortcut),
        2 => Err(HotkeyError::PermissionDenied),
        _ => Err(HotkeyError::TapUnavailable),
    }
}

extern "C" fn denoiser_new(channels: u16) -> *mut c_void {
    Box::into_raw(Box::new(Denoiser::new(channels))).cast()
}

extern "C" fn denoiser_process(state: *mut c_void, samples: *mut f32, length: usize) {
    if state.is_null() || samples.is_null() {
        return;
    }
    let denoiser = unsafe { &mut *state.cast::<Denoiser>() };
    denoiser.process(unsafe { std::slice::from_raw_parts_mut(samples, length) });
}

extern "C" fn denoiser_free(state: *mut c_void) {
    if !state.is_null() {
        drop(unsafe { Box::from_raw(state.cast::<Denoiser>()) });
    }
}

extern "C" fn log_native(message: *const c_char) {
    let message = unsafe { CStr::from_ptr(message) }.to_string_lossy();
    let message = norisk_logging::mask_sensitive_data(&message);
    eprintln!("{message}");
    log::info!("{message}");
}

pub fn capture_supported() -> bool {
    unsafe { nrc_capture_supported() }
}

pub fn input_monitoring(request: bool) -> bool {
    unsafe { nrc_input_monitoring(request) }
}

pub fn open_permission_settings(permission: u8) -> bool {
    unsafe { nrc_open_permission_settings(permission) }
}
