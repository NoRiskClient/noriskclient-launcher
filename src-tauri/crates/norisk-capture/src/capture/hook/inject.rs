use std::path::Path;

use anyhow::{Context, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
    TH32CS_SNAPMODULE32,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows::Win32::System::Threading::{
    CreateRemoteThread, GetExitCodeThread, OpenProcess, WaitForSingleObject,
    PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ,
    PROCESS_VM_WRITE,
};

const LOAD_TIMEOUT_MS: u32 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Injected {
    Loaded,
    AlreadyPresent,
}

pub fn inject(pid: u32, dll: &Path) -> Result<Injected> {
    let dll = dll
        .canonicalize()
        .with_context(|| format!("the hook DLL is not where it should be: {}", dll.display()))?;

    let file_name = dll
        .file_name()
        .and_then(|n| n.to_str())
        .context("the hook DLL path has no file name")?
        .to_owned();

    if is_module_loaded(pid, &file_name)? {
        return Ok(Injected::AlreadyPresent);
    }

    let process = unsafe {
        OpenProcess(
            PROCESS_CREATE_THREAD
                | PROCESS_QUERY_INFORMATION
                | PROCESS_VM_OPERATION
                | PROCESS_VM_READ
                | PROCESS_VM_WRITE,
            false,
            pid,
        )
    }
    .with_context(|| format!("could not open process {pid} for injection"))?;

    let guard = HandleGuard(process);

    let wide: Vec<u16> = dll
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();

    let remote = unsafe { VirtualAllocEx(guard.0, None, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) };
    if remote.is_null() {
        anyhow::bail!("could not allocate {bytes} bytes in process {pid}");
    }
    let remote = RemoteAlloc {
        process: guard.0,
        address: remote,
    };

    unsafe {
        windows::Win32::System::Diagnostics::Debug::WriteProcessMemory(
            guard.0,
            remote.address,
            wide.as_ptr() as *const _,
            bytes,
            None,
        )
        .context("could not write the DLL path into the target process")?;
    }

    let kernel32 = unsafe { GetModuleHandleW(windows::core::w!("kernel32.dll")) }
        .context("kernel32.dll is not loaded, which cannot happen")?;
    let load_library = unsafe { GetProcAddress(kernel32, windows::core::s!("LoadLibraryW")) }
        .context("LoadLibraryW not found in kernel32")?;

    let start: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32 =
        unsafe { std::mem::transmute(load_library) };

    let thread = unsafe {
        CreateRemoteThread(
            guard.0,
            None,
            0,
            Some(start),
            Some(remote.address),
            0,
            None,
        )
    }
    .with_context(|| format!("could not start the loader thread in process {pid}"))?;
    let thread = HandleGuard(thread);

    let waited = unsafe { WaitForSingleObject(thread.0, LOAD_TIMEOUT_MS) };
    if waited != WAIT_OBJECT_0 {
        anyhow::bail!("the game did not finish loading the hook within {LOAD_TIMEOUT_MS} ms");
    }

    let mut exit_code = 0u32;
    unsafe { GetExitCodeThread(thread.0, &mut exit_code) }
        .context("could not read the loader thread's result")?;
    if exit_code == 0 {
        anyhow::bail!(
            "the game refused to load {} — check that it matches the process architecture",
            dll.display()
        );
    }

    Ok(Injected::Loaded)
}

pub fn is_module_loaded(pid: u32, file_name: &str) -> Result<bool> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) }
        .with_context(|| format!("could not list the modules of process {pid}"))?;
    let snapshot = HandleGuard(snapshot);

    let mut entry = MODULEENTRY32W {
        dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
        ..Default::default()
    };

    if unsafe { Module32FirstW(snapshot.0, &mut entry) }.is_err() {
        return Ok(false);
    }

    loop {
        let name = String::from_utf16_lossy(
            &entry.szModule[..entry
                .szModule
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szModule.len())],
        );
        if name.eq_ignore_ascii_case(file_name) {
            return Ok(true);
        }
        if unsafe { Module32NextW(snapshot.0, &mut entry) }.is_err() {
            return Ok(false);
        }
    }
}

struct HandleGuard(HANDLE);

impl Drop for HandleGuard {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

struct RemoteAlloc {
    process: HANDLE,
    address: *mut std::ffi::c_void,
}

impl Drop for RemoteAlloc {
    fn drop(&mut self) {
        unsafe {
            let _ = VirtualFreeEx(self.process, self.address, 0, MEM_RELEASE);
        }
    }
}

use std::os::windows::ffi::OsStrExt;

pub fn locate_hook_dll() -> Result<std::path::PathBuf> {
    let exe = std::env::current_exe().context("could not find our own executable")?;
    let dir = exe
        .parent()
        .context("our own executable has no directory")?;

    let name = "graphics-hook64.dll";
    let candidates = [
        dir.join(name),
        dir.join("../../../third-party/graphics-hook").join(name),
        dir.join("../../third-party/graphics-hook").join(name),
    ];

    for candidate in &candidates {
        if candidate.is_file() {
            return candidate
                .canonicalize()
                .with_context(|| format!("could not resolve {}", candidate.display()));
        }
    }

    anyhow::bail!(
        "{name} was not found next to {}. Run scripts/setup-native-deps.mjs to fetch it.",
        dir.display()
    )
}
