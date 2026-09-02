use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Binding {
    pub key: u32,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

impl Binding {
    pub fn parse(spec: &str) -> Option<Self> {
        let mut binding = Binding {
            key: 0,
            ctrl: false,
            shift: false,
            alt: false,
        };

        let mut code = None;
        for part in spec.split('+').map(str::trim).filter(|p| !p.is_empty()) {
            match part {
                "Ctrl" | "Control" => binding.ctrl = true,
                "Shift" => binding.shift = true,
                "Alt" => binding.alt = true,
                "Super" | "Meta" | "Cmd" => {}
                other => code = Some(other),
            }
        }

        binding.key = virtual_key(code?)?;
        Some(binding)
    }

    fn matches(&self, pressed_key: u32) -> bool {
        if pressed_key != self.key {
            return false;
        }
        held(VK_CONTROL.0 as i32) == self.ctrl
            && held(VK_SHIFT.0 as i32) == self.shift
            && held(VK_MENU.0 as i32) == self.alt
    }
}

fn held(vk: i32) -> bool {
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

fn virtual_key(code: &str) -> Option<u32> {
    if let Some(letter) = code.strip_prefix("Key") {
        let byte = letter.as_bytes();
        if byte.len() == 1 && byte[0].is_ascii_uppercase() {
            return Some(byte[0] as u32);
        }
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        let byte = digit.as_bytes();
        if byte.len() == 1 && byte[0].is_ascii_digit() {
            return Some(byte[0] as u32);
        }
    }
    if let Some(number) = code.strip_prefix('F') {
        if let Ok(n) = number.parse::<u32>() {
            if (1..=24).contains(&n) {
                return Some(0x6F + n);
            }
        }
    }
    if let Some(digit) = code.strip_prefix("Numpad") {
        if let Ok(n) = digit.parse::<u32>() {
            if n <= 9 {
                return Some(0x60 + n);
            }
        }
    }

    Some(match code {
        "Space" => 0x20,
        "Enter" => 0x0D,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "ArrowUp" => 0x26,
        "ArrowDown" => 0x28,
        "ArrowLeft" => 0x25,
        "ArrowRight" => 0x27,
        "Pause" => 0x13,
        "ScrollLock" => 0x91,
        "PrintScreen" => 0x2C,
        "Backquote" => 0xC0,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB,
        "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        _ => return None,
    })
}

#[derive(Debug, Clone, Copy)]
pub enum Press {
    Fired(u8),
    Ignored {
        key: u32,
        ctrl: bool,
        shift: bool,
        alt: bool,
    },
}

struct Watch {
    bindings: Vec<(Binding, u8)>,
    events: Sender<Press>,
}

static WATCH: Mutex<Option<Watch>> = Mutex::new(None);

static THREAD: Mutex<Option<HookThread>> = Mutex::new(None);

struct HookThread {
    thread_id: u32,
    handle: Option<std::thread::JoinHandle<()>>,
}

pub fn install(bindings: Vec<(Binding, u8)>, events: Sender<Press>) -> crate::error::Result<()> {
    uninstall();

    if bindings.is_empty() {
        return Ok(());
    }

    *WATCH.lock().unwrap_or_else(|e| e.into_inner()) = Some(Watch { bindings, events });

    let (ready_tx, ready_rx) = mpsc::channel::<std::result::Result<u32, String>>();

    let handle = std::thread::Builder::new()
        .name("nrc-hotkey-hook".into())
        .spawn(move || {
            let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), None, 0) };

            let hook = match hook {
                Ok(hook) => {
                    let _ = ready_tx.send(Ok(unsafe {
                        windows::Win32::System::Threading::GetCurrentThreadId()
                    }));
                    hook
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("{e}")));
                    return;
                }
            };

            let mut message = MSG::default();
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
                unsafe { DispatchMessageW(&message) };
            }

            log::debug!("Hotkey hook thread finished");

            let _ = unsafe { UnhookWindowsHookEx(hook) };
        })
        .map_err(|e| {
            crate::error::AppError::Other(format!("could not start the hotkey thread: {e}"))
        })?;

    match ready_rx.recv() {
        Ok(Ok(thread_id)) => {
            *THREAD.lock().unwrap_or_else(|e| e.into_inner()) = Some(HookThread {
                thread_id,
                handle: Some(handle),
            });
            Ok(())
        }
        Ok(Err(e)) => {
            *WATCH.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Err(crate::error::AppError::Other(format!(
                "could not install the keyboard hook: {e}"
            )))
        }
        Err(_) => {
            *WATCH.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Err(crate::error::AppError::Other(
                "the hotkey thread stopped before it was ready".into(),
            ))
        }
    }
}

pub fn uninstall() {
    let thread = THREAD.lock().unwrap_or_else(|e| e.into_inner()).take();
    *WATCH.lock().unwrap_or_else(|e| e.into_inner()) = None;

    if let Some(mut thread) = thread {
        use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        let _ = unsafe { PostThreadMessageW(thread.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        if let Some(handle) = thread.handle.take() {
            let _ = handle.join();
        }
    }
}

unsafe extern "system" fn callback(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);

        if let Ok(watch) = WATCH.try_lock() {
            if let Some(watch) = watch.as_ref() {
                if let Some((_, tag)) = watch.bindings.iter().find(|(b, _)| b.matches(info.vkCode))
                {
                    let _ = watch.events.send(Press::Fired(*tag));
                } else if watch.bindings.iter().any(|(b, _)| b.key == info.vkCode) {
                    let _ = watch.events.send(Press::Ignored {
                        key: info.vkCode,
                        ctrl: held(VK_CONTROL.0 as i32),
                        shift: held(VK_SHIFT.0 as i32),
                        alt: held(VK_MENU.0 as i32),
                    });
                }
            }
        }
    }

    CallNextHookEx(None, code, wparam, lparam)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_and_function_keys_parse() {
        assert_eq!(Binding::parse("KeyJ").unwrap().key, 0x4A);
        assert_eq!(Binding::parse("F8").unwrap().key, 0x77);
        assert_eq!(Binding::parse("F1").unwrap().key, 0x70);
        assert_eq!(Binding::parse("Digit5").unwrap().key, 0x35);
        assert_eq!(Binding::parse("Space").unwrap().key, 0x20);
    }

    #[test]
    fn modifiers_are_read_off_the_front() {
        let b = Binding::parse("Ctrl+Shift+KeyA").unwrap();
        assert_eq!(b.key, 0x41);
        assert!(b.ctrl && b.shift && !b.alt);

        let plain = Binding::parse("F8").unwrap();
        assert!(!plain.ctrl && !plain.shift && !plain.alt);
    }

    #[test]
    fn an_unknown_key_is_rejected_rather_than_guessed() {
        assert!(Binding::parse("Fnord").is_none());
        assert!(Binding::parse("").is_none());
        assert!(Binding::parse("Ctrl+").is_none());
    }

    #[test]
    fn a_key_that_windows_has_no_name_for_is_still_bindable() {
        let b = Binding::parse("Super+KeyK").unwrap();
        assert_eq!(b.key, 0x4B);
        assert!(!b.ctrl && !b.shift && !b.alt);
    }
}
