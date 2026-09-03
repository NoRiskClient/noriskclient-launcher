use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use windows::core::PCSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{ReadFile, PIPE_ACCESS_DUPLEX};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeA, PIPE_READMODE_MESSAGE, PIPE_TYPE_MESSAGE,
    PIPE_WAIT,
};

const BUF_SIZE: u32 = 1024;

pub struct HookLog {
    lines: Arc<Mutex<Vec<String>>>,
    handle: HANDLE,
}

impl HookLog {
    pub fn start(pid: u32) -> Result<Self> {
        let name = format!("\\\\.\\pipe\\CaptureHook_Pipe{pid}\0");

        let handle = unsafe {
            CreateNamedPipeA(
                PCSTR(name.as_ptr()),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                1,
                BUF_SIZE,
                BUF_SIZE,
                0,
                None,
            )
        }
        .context("could not create the hook's log pipe")?;

        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);

        let raw = handle.0 as isize;
        std::thread::Builder::new()
            .name("nrc-hook-log".into())
            .spawn(move || {
                let handle = HANDLE(raw as *mut std::ffi::c_void);
                unsafe {
                    let _ = ConnectNamedPipe(handle, None);
                }

                let mut buf = [0u8; BUF_SIZE as usize];
                loop {
                    let mut read = 0u32;
                    let ok = unsafe { ReadFile(handle, Some(&mut buf), Some(&mut read), None) };
                    if ok.is_err() || read == 0 {
                        break;
                    }
                    let text = String::from_utf8_lossy(&buf[..read as usize])
                        .trim_end_matches('\0')
                        .trim()
                        .to_string();
                    if !text.is_empty() {
                        sink.lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .push(text);
                    }
                }
            })
            .context("could not start the hook log reader")?;

        Ok(Self { lines, handle })
    }

    pub fn lines(&self) -> Vec<String> {
        self.lines
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl Drop for HookLog {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            let _ = unsafe { CloseHandle(self.handle) };
        }
    }
}
