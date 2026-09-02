use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use windows::core::HSTRING;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, WAIT_OBJECT_0};
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ, FILE_MAP_WRITE,
    MEMORY_MAPPED_VIEW_ADDRESS,
};
use windows::Win32::System::Threading::{
    CreateMutexW, OpenEventW, OpenMutexW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE,
    SYNCHRONIZATION_ACCESS_RIGHTS,
};

use super::info::{names, CaptureType, HookInfo, SharedTextureData};

const SYNCHRONIZE: SYNCHRONIZATION_ACCESS_RIGHTS = SYNCHRONIZATION_ACCESS_RIGHTS(0x0010_0000);

pub const HOOK_TIMEOUT: Duration = Duration::from_secs(20);

const RETRY_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Debug)]
pub enum HookStep {
    Waiting,
    Ready(HookTexture),
    Failed(anyhow::Error),
}

#[derive(Debug, Clone, Copy)]
pub struct HookTexture {
    pub handle: u32,
    pub map_id: u32,
    pub width: u32,
    pub height: u32,
    pub format: u32,
    pub flip: bool,
}

pub struct HookSession {
    pid: u32,
    hwnd: HWND,
    started: Instant,
    last_try: Option<Instant>,
    stage: Stage,
    ready_seen: bool,
    _keepalive: Option<OwnedHandle>,
    info_map: Option<MappedInfo>,
    events: Option<Events>,
    texture_mutexes: Option<(OwnedHandle, OwnedHandle)>,
    borrowed: bool,

    fps: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    WaitingForHook,
    WaitingForReady,
    Done,
}

impl HookSession {
    pub fn new(pid: u32, hwnd: HWND, fps: u32) -> Result<Self> {
        let borrowed = open_mutex(names::WINDOW_HOOK_KEEPALIVE, pid).is_some();
        if borrowed {
            log::info!(
                "Process {pid} is already hooked by another capture program; reading its frames without reconfiguring the hook"
            );
        }

        let keepalive = unsafe {
            CreateMutexW(
                None,
                false,
                &HSTRING::from(with_pid(names::WINDOW_HOOK_KEEPALIVE, pid)),
            )
        }
        .context("could not create the keepalive mutex")?;

        Ok(Self {
            pid,
            hwnd,
            started: Instant::now(),
            last_try: None,
            stage: Stage::WaitingForHook,
            ready_seen: false,
            _keepalive: Some(OwnedHandle(keepalive)),
            info_map: None,
            events: None,
            texture_mutexes: None,
            borrowed,
            fps: fps.max(1),
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn poll(&mut self) -> HookStep {
        if self.stage == Stage::Done {
            return HookStep::Waiting;
        }

        if self.started.elapsed() > HOOK_TIMEOUT {
            return HookStep::Failed(anyhow::anyhow!(
                "the hook in process {} did not start within {:?}",
                self.pid,
                HOOK_TIMEOUT
            ));
        }

        if let Some(last) = self.last_try {
            if last.elapsed() < RETRY_INTERVAL {
                return HookStep::Waiting;
            }
        }
        self.last_try = Some(Instant::now());

        match self.stage {
            Stage::WaitingForHook => match self.try_attach() {
                Ok(true) => HookStep::Waiting,
                Ok(false) => HookStep::Waiting,
                Err(e) => HookStep::Failed(e),
            },
            Stage::WaitingForReady => match self.try_ready() {
                Ok(Some(texture)) => {
                    self.stage = Stage::Done;
                    HookStep::Ready(texture)
                }
                Ok(None) => HookStep::Waiting,
                Err(e) => HookStep::Failed(e),
            },
            Stage::Done => HookStep::Waiting,
        }
    }

    pub fn refresh_texture(&self, known_map_id: u32) -> Result<Option<HookTexture>> {
        let Some(info) = self.info_map.as_ref().map(|m| m.read()) else {
            return Ok(None);
        };
        if info.map_id == 0 || info.cx == 0 || info.cy == 0 {
            return Ok(None);
        }
        if info.map_id == known_map_id {
            return Ok(None);
        }

        let Some(data) = SharedTextureData::open(self.hwnd, info.map_id)? else {
            return Ok(None);
        };
        if data.tex_handle == 0 {
            return Ok(None);
        }

        Ok(Some(HookTexture {
            handle: data.tex_handle,
            map_id: info.map_id,
            width: info.cx,
            height: info.cy,
            format: info.format,
            flip: info.flip,
        }))
    }

    fn try_attach(&mut self) -> Result<bool> {
        let Some(mutex1) = open_mutex(names::MUTEX_TEXTURE1, self.pid) else {
            return Ok(false);
        };
        let Some(mutex2) = open_mutex(names::MUTEX_TEXTURE2, self.pid) else {
            return Ok(false);
        };
        let Some(mut info) = MappedInfo::open(self.pid)? else {
            return Ok(false);
        };
        let Some(events) = Events::open(self.pid) else {
            return Ok(false);
        };

        let current = info.read();
        if current.hook_ver_major != 0 && !current.version_matches() {
            anyhow::bail!(
                "the hook in process {} speaks version {}.{}, we speak {}.{}",
                self.pid,
                current.hook_ver_major,
                current.hook_ver_minor,
                super::info::HOOK_VER_MAJOR,
                super::info::HOOK_VER_MINOR
            );
        }

        info.configure(self.fps, self.borrowed);
        events.signal_init()?;

        self.texture_mutexes = Some((mutex1, mutex2));
        self.info_map = Some(info);
        self.events = Some(events);
        self.stage = Stage::WaitingForReady;
        Ok(true)
    }

    fn try_ready(&mut self) -> Result<Option<HookTexture>> {
        if !self.ready_seen {
            let events = self
                .events
                .as_ref()
                .context("ready check without events, which cannot happen")?;

            if !events.hook_ready.is_signalled() {
                return Ok(None);
            }
            self.ready_seen = true;
        }

        let info = self
            .info_map
            .as_ref()
            .context("ready check without an info block")?
            .read();

        if info.map_id == 0 {
            if let Some(events) = self.events.as_ref() {
                events.nudge_restart();
            }
            return Ok(None);
        }

        let Some(handle) = SharedTextureData::open(self.hwnd, info.map_id)? else {
            if !self.borrowed {
                if let Some(events) = self.events.as_ref() {
                    events.nudge_restart();
                }
            }
            return Ok(None);
        };
        if handle.tex_handle == 0 {
            return Ok(None);
        }

        match info.capture_type() {
            Some(CaptureType::Texture) => {}
            Some(CaptureType::Memory) => {
                anyhow::bail!("the hook fell back to shared memory instead of a shared texture");
            }
            None => {
                anyhow::bail!("the hook reported an unknown capture type {}", info.capture_type)
            }
        }

        if info.cx == 0 || info.cy == 0 {
            return Ok(None);
        }

        Ok(Some(HookTexture {
            handle: handle.tex_handle,
            map_id: info.map_id,
            width: info.cx,
            height: info.cy,
            format: info.format,
            flip: info.flip,
        }))
    }
}

fn with_pid(base: &str, pid: u32) -> String {
    format!("{base}{pid}")
}

fn open_mutex(name: &str, pid: u32) -> Option<OwnedHandle> {
    unsafe { OpenMutexW(SYNCHRONIZE, false, &HSTRING::from(with_pid(name, pid))) }
        .ok()
        .map(OwnedHandle)
}

fn open_event(name: &str, pid: u32) -> Option<OwnedHandle> {
    unsafe {
        OpenEventW(
            EVENT_MODIFY_STATE | SYNCHRONIZE,
            false,
            &HSTRING::from(with_pid(name, pid)),
        )
    }
    .ok()
    .map(OwnedHandle)
}

struct Events {
    hook_init: OwnedHandle,
    hook_ready: OwnedHandle,
    hook_restart: OwnedHandle,
    _hook_exit: OwnedHandle,
    _hook_stop: OwnedHandle,
}

impl Events {
    fn open(pid: u32) -> Option<Self> {
        Some(Self {
            hook_init: open_event(names::EVENT_HOOK_INIT, pid)?,
            hook_ready: open_event(names::EVENT_HOOK_READY, pid)?,
            hook_restart: open_event(names::EVENT_CAPTURE_RESTART, pid)?,
            _hook_exit: open_event(names::EVENT_HOOK_EXIT, pid)?,
            _hook_stop: open_event(names::EVENT_CAPTURE_STOP, pid)?,
        })
    }

    fn signal_init(&self) -> Result<()> {
        unsafe { SetEvent(self.hook_init.0) }.context("could not signal the hook to initialise")?;
        unsafe { SetEvent(self.hook_restart.0) }
            .context("could not signal the hook to (re)start its capture")
    }

    fn nudge_restart(&self) {
        let _ = unsafe { SetEvent(self.hook_restart.0) };
    }
}

struct MappedInfo {
    view: MEMORY_MAPPED_VIEW_ADDRESS,
    _mapping: OwnedHandle,
}

impl MappedInfo {
    fn open(pid: u32) -> Result<Option<Self>> {
        let Ok(mapping) = (unsafe {
            OpenFileMappingW(
                (FILE_MAP_READ | FILE_MAP_WRITE).0,
                false,
                &HSTRING::from(with_pid(names::SHMEM_HOOK_INFO, pid)),
            )
        }) else {
            return Ok(None);
        };
        let mapping = OwnedHandle(mapping);

        let view = unsafe {
            MapViewOfFile(
                mapping.0,
                FILE_MAP_READ | FILE_MAP_WRITE,
                0,
                0,
                std::mem::size_of::<HookInfo>(),
            )
        };
        if view.Value.is_null() {
            anyhow::bail!("could not map the hook's info block");
        }

        Ok(Some(Self {
            view,
            _mapping: mapping,
        }))
    }

    fn read(&self) -> HookInfo {
        unsafe { std::ptr::read_unaligned(self.view.Value as *const HookInfo) }
    }

    fn configure(&mut self, fps: u32, borrowed: bool) {
        let mut info = self.read();

        info.frame_interval = cooperative_interval(info.frame_interval, fps);

        if !borrowed {
            info.force_shmem = false;
            info.unused_use_scale = false;
            info.allow_srgb_alias = true;
            info.capture_overlay = false;
        }

        unsafe { std::ptr::write_unaligned(self.view.Value as *mut HookInfo, info) };
    }
}

impl Drop for MappedInfo {
    fn drop(&mut self) {
        if !self.view.Value.is_null() {
            let _ = unsafe { UnmapViewOfFile(self.view) };
        }
    }
}

impl SharedTextureData {
    fn open(hwnd: HWND, map_id: u32) -> Result<Option<Self>> {
        use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};
        let top = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let top = if top.is_invalid() { hwnd } else { top };

        let name = format!(
            "{}_{}_{}",
            names::SHMEM_TEXTURE, top.0 as usize as u64, map_id
        );

        let Ok(mapping) = (unsafe { OpenFileMappingW(FILE_MAP_READ.0, false, &HSTRING::from(name)) })
        else {
            return Ok(None);
        };
        let mapping = OwnedHandle(mapping);

        let view = unsafe {
            MapViewOfFile(
                mapping.0,
                FILE_MAP_READ,
                0,
                0,
                std::mem::size_of::<SharedTextureData>(),
            )
        };
        if view.Value.is_null() {
            return Ok(None);
        }

        let data = unsafe { std::ptr::read_unaligned(view.Value as *const SharedTextureData) };
        let _ = unsafe { UnmapViewOfFile(view) };
        Ok(Some(data))
    }
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn is_signalled(&self) -> bool {
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

unsafe impl Send for HookSession {}

fn cooperative_interval(published: u64, fps: u32) -> u64 {
    let wanted = 10_000_000 / fps.max(1) as u64;
    match published {
        0 => wanted,
        already => already.min(wanted),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HZ_30: u64 = 333_333;
    const HZ_60: u64 = 166_666;

    #[test]
    fn object_names_carry_the_pid() {
        assert_eq!(
            with_pid(names::SHMEM_HOOK_INFO, 1234),
            "CaptureHook_HookInfo1234"
        );
        assert_eq!(
            with_pid(names::WINDOW_HOOK_KEEPALIVE, 40116),
            "CaptureHook_KeepAlive40116"
        );
    }

    #[test]
    fn the_frame_interval_is_in_hundred_nanosecond_units() {
        assert_eq!(cooperative_interval(0, 60), HZ_60);
        assert_eq!(cooperative_interval(0, 30), HZ_30);
    }

    #[test]
    fn a_capturer_already_asking_for_more_frames_is_not_slowed_down() {
        assert_eq!(cooperative_interval(HZ_60, 30), HZ_60);
    }

    #[test]
    fn a_capturer_asking_for_fewer_frames_is_sped_up_to_what_we_need() {
        assert_eq!(cooperative_interval(HZ_30, 60), HZ_60);
    }

    #[test]
    fn a_nonsensical_rate_does_not_divide_by_zero() {
        assert_eq!(cooperative_interval(0, 0), 10_000_000);
    }
}
