use std::path::Path;

use anyhow::{Context, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
    TH32CS_SNAPMODULE32,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
use windows::Win32::System::Memory::{
    VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
};
use windows::Win32::System::Threading::{
    CreateRemoteThread, GetExitCodeThread, OpenProcess, WaitForSingleObject,
    PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ,
    PROCESS_VM_WRITE,
};

const LOAD_TIMEOUT_MS: u32 = 10_000;

const INJECT_ARG: &str = "--inject-into";

const MESSAGE_HOOK_NUDGE: u32 = windows::Win32::UI::WindowsAndMessaging::WM_USER + 432;
const MESSAGE_HOOK_NUDGES: u32 = 8;
const MESSAGE_HOOK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const MESSAGE_HOOK_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

const NEVER_HOOK: &[&str] = &[
    "explorer",
    "chrome",
    "msedge",
    "firefox",
    "opera",
    "brave",
    "discord",
    "steam",
    "steamwebhelper",
    "battle.net",
    "galaxyclient",
    "epicgameslauncher",
    "uplay",
    "upc",
    "origin",
    "eadesktop",
    "riotclientux",
    "skype",
    "teams",
    "devenv",
    "code",
    "taskmgr",
    "cmd",
    "powershell",
    "windowsterminal",
    "systemsettings",
    "applicationframehost",
    "shellexperiencehost",
    "searchui",
    "searchhost",
    "lockapp",
    "dwm",
    "winlogon",
    "csrss",
    "services",
    "lsass",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Injected {
    Loaded,
    AlreadyPresent,
}

pub fn inject(pid: u32, thread_id: u32, dll: &Path) -> Result<Injected> {
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

    if let Some(executable) = process_executable(pid) {
        if is_never_hooked(&executable) {
            anyhow::bail!("{executable} is not a program to load a capture hook into");
        }
    }

    match inject_through_message_hook(pid, thread_id, &dll, &file_name) {
        Ok(()) => return Ok(Injected::Loaded),
        Err(e) => log::warn!(
            "Could not load the hook into process {pid} through a message hook ({e:#}); trying a remote thread"
        ),
    }

    inject_through_remote_thread(pid, &dll)?;
    Ok(Injected::Loaded)
}

fn inject_through_message_hook(
    pid: u32,
    thread_id: u32,
    dll: &Path,
    file_name: &str,
) -> Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    if thread_id == 0 {
        anyhow::bail!("the window has no thread to post to");
    }

    let helper = std::env::current_exe().context("could not find our own executable")?;
    let mut child = std::process::Command::new(helper)
        .arg(INJECT_ARG)
        .arg(thread_id.to_string())
        .arg(dll)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .context("could not start the injector")?;

    let deadline = std::time::Instant::now() + MESSAGE_HOOK_BUDGET;
    let mut loaded = false;
    while std::time::Instant::now() < deadline {
        if is_module_loaded(pid, file_name)? {
            loaded = true;
            break;
        }
        std::thread::sleep(MESSAGE_HOOK_INTERVAL);
    }

    let _ = child.kill();
    let _ = child.wait();

    if !loaded {
        anyhow::bail!("the game did not pick the hook up within {MESSAGE_HOOK_BUDGET:?}");
    }
    Ok(())
}

pub fn run_injector(thread_id: u32, dll: &Path) -> Result<()> {
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        PostThreadMessageW, SetWindowsHookExW, HOOKPROC, WH_GETMESSAGE,
    };

    let wide: Vec<u16> = dll.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let library = unsafe { LoadLibraryW(windows::core::PCWSTR(wide.as_ptr())) }
        .with_context(|| format!("could not load {}", dll.display()))?;

    let entry = unsafe { GetProcAddress(library, windows::core::s!("dummy_debug_proc")) }
        .context("the hook DLL does not export dummy_debug_proc")?;
    let entry: HOOKPROC = Some(unsafe {
        std::mem::transmute::<
            unsafe extern "system" fn() -> isize,
            unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT,
        >(entry)
    });

    let hook = unsafe { SetWindowsHookExW(WH_GETMESSAGE, entry, HINSTANCE(library.0), thread_id) }
        .context("SetWindowsHookEx was refused")?;

    for _ in 0..MESSAGE_HOOK_NUDGES {
        std::thread::sleep(MESSAGE_HOOK_INTERVAL);
        unsafe {
            let _ = PostThreadMessageW(
                thread_id,
                MESSAGE_HOOK_NUDGE,
                WPARAM(0),
                LPARAM(hook.0 as isize),
            );
        }
    }

    Ok(())
}

pub fn injector_request(args: &[String]) -> Option<(u32, std::path::PathBuf)> {
    let at = args.iter().position(|a| a == INJECT_ARG)?;
    let thread_id = args.get(at + 1)?.parse().ok()?;
    let dll = args.get(at + 2)?;
    Some((thread_id, std::path::PathBuf::from(dll)))
}

fn process_executable(pid: u32) -> Option<String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) }.ok()?;
    let snapshot = HandleGuard(snapshot);

    let mut entry = MODULEENTRY32W {
        dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
        ..Default::default()
    };

    unsafe { Module32FirstW(snapshot.0, &mut entry) }.ok()?;

    let end = entry
        .szModule
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(entry.szModule.len());
    Some(String::from_utf16_lossy(&entry.szModule[..end]))
}

fn inject_through_remote_thread(pid: u32, dll: &Path) -> Result<()> {
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

    Ok(())
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

fn is_never_hooked(executable: &str) -> bool {
    let stem = executable
        .rsplit_once('.')
        .map_or(executable, |(head, _)| head);
    NEVER_HOOK.iter().any(|denied| stem.eq_ignore_ascii_case(denied))
}

#[cfg(test)]
mod tests {
    use super::is_never_hooked;

    #[test]
    fn programs_a_capture_hook_has_no_business_in_are_refused() {
        for exe in ["chrome.exe", "Discord.exe", "steam.exe", "explorer.exe", "lsass.exe"] {
            assert!(is_never_hooked(exe), "{exe} should be refused");
        }
    }

    #[test]
    fn games_are_left_alone() {
        for exe in ["javaw.exe", "RocketLeague.exe", "cs2.exe", "Minecraft.Windows.exe"] {
            assert!(!is_never_hooked(exe), "{exe} should be allowed");
        }
    }

    #[test]
    fn the_match_ignores_case_and_the_extension() {
        assert!(is_never_hooked("CHROME.EXE"));
        assert!(is_never_hooked("chrome"));
    }

    #[test]
    fn a_name_that_merely_contains_a_refused_one_is_allowed() {
        assert!(!is_never_hooked("chromelike.exe"));
        assert!(!is_never_hooked("mysteam.exe"));
    }
}
