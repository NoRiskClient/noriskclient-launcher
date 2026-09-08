use std::ffi::{c_char, CStr, CString};

extern "C" {
    fn nrc_capture_main();
    fn nrc_open_apps(foreground: bool) -> *mut c_char;
    fn nrc_free_string(value: *mut c_char);
    fn nrc_hotkeys(bindings: *const c_char, callback: extern "C" fn(u8)) -> bool;
}

pub fn run() {
    unsafe { nrc_capture_main() }
}

pub fn open_apps(foreground: bool) -> String {
    unsafe {
        let ptr = nrc_open_apps(foreground);
        if ptr.is_null() {
            return "[]".into();
        }
        let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        nrc_free_string(ptr);
        value
    }
}

pub fn hotkeys(bindings: &str, callback: extern "C" fn(u8)) -> bool {
    let Ok(bindings) = CString::new(bindings) else {
        return false;
    };
    unsafe { nrc_hotkeys(bindings.as_ptr(), callback) }
}
