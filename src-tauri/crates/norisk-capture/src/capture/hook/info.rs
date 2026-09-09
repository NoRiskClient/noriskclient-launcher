#![allow(dead_code)]
pub const HOOK_VER_MAJOR: u32 = 1;
pub const HOOK_VER_MINOR: u32 = 8;

pub mod names {
    pub const EVENT_CAPTURE_RESTART: &str = "CaptureHook_Restart";
    pub const EVENT_CAPTURE_STOP: &str = "CaptureHook_Stop";
    pub const EVENT_HOOK_READY: &str = "CaptureHook_HookReady";
    pub const EVENT_HOOK_EXIT: &str = "CaptureHook_Exit";
    pub const EVENT_HOOK_INIT: &str = "CaptureHook_Initialize";
    pub const WINDOW_HOOK_KEEPALIVE: &str = "CaptureHook_KeepAlive";
    pub const MUTEX_TEXTURE1: &str = "CaptureHook_TextureMutex1";
    pub const MUTEX_TEXTURE2: &str = "CaptureHook_TextureMutex2";
    pub const SHMEM_HOOK_INFO: &str = "CaptureHook_HookInfo";
    pub const SHMEM_TEXTURE: &str = "CaptureHook_Texture";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum CaptureType {
    Memory = 0,
    Texture = 1,
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct SharedTextureData {
    pub tex_handle: u32,
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct SharedMemoryData {
    pub last_tex: i32,
    pub tex1_offset: u32,
    pub tex2_offset: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct D3d8Offsets {
    pub present: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct D3d9Offsets {
    pub present: u32,
    pub present_ex: u32,
    pub present_swap: u32,
    pub d3d9_clsoff: u32,
    pub is_d3d9ex_clsoff: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct DxgiOffsets {
    pub present: u32,
    pub resize: u32,
    pub present1: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct DdrawOffsets {
    pub surface_create: u32,
    pub surface_restore: u32,
    pub surface_release: u32,
    pub surface_unlock: u32,
    pub surface_blt: u32,
    pub surface_flip: u32,
    pub surface_set_palette: u32,
    pub palette_set_entries: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct DxgiOffsets2 {
    pub release: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct D3d12Offsets {
    pub execute_command_lists: u32,
}

#[derive(Debug, Clone, Copy, Default)]
#[repr(C)]
pub struct GraphicsOffsets {
    pub d3d8: D3d8Offsets,
    pub d3d9: D3d9Offsets,
    pub dxgi: DxgiOffsets,
    pub ddraw: DdrawOffsets,
    pub dxgi2: DxgiOffsets2,
    pub d3d12: D3d12Offsets,
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct HookInfo {
    pub hook_ver_major: u32,
    pub hook_ver_minor: u32,

    pub capture_type: u32,
    pub window: u32,
    pub format: u32,
    pub cx: u32,
    pub cy: u32,
    pub unused_base_cx: u32,
    pub unused_base_cy: u32,
    pub pitch: u32,
    pub map_id: u32,
    pub map_size: u32,
    pub flip: bool,

    pub frame_interval: u64,

    pub unused_use_scale: bool,
    pub force_shmem: bool,
    pub capture_overlay: bool,
    pub allow_srgb_alias: bool,

    pub offsets: GraphicsOffsets,

    pub reserved: [u32; 126],
}

impl Default for HookInfo {
    fn default() -> Self {
        Self {
            hook_ver_major: 0,
            hook_ver_minor: 0,
            capture_type: 0,
            window: 0,
            format: 0,
            cx: 0,
            cy: 0,
            unused_base_cx: 0,
            unused_base_cy: 0,
            pitch: 0,
            map_id: 0,
            map_size: 0,
            flip: false,
            frame_interval: 0,
            unused_use_scale: false,
            force_shmem: false,
            capture_overlay: false,
            allow_srgb_alias: false,
            offsets: GraphicsOffsets::default(),
            reserved: [0; 126],
        }
    }
}

impl HookInfo {
    pub fn capture_type(&self) -> Option<CaptureType> {
        match self.capture_type {
            0 => Some(CaptureType::Memory),
            1 => Some(CaptureType::Texture),
            _ => None,
        }
    }

    pub fn version_matches(&self) -> bool {
        self.hook_ver_major == HOOK_VER_MAJOR
    }
}

const _: () = {
    assert!(std::mem::size_of::<GraphicsOffsets>() == 76);
    assert!(std::mem::size_of::<HookInfo>() == 648, "hook_info ABI mismatch");
    assert!(std::mem::size_of::<SharedTextureData>() == 4);
    assert!(std::mem::size_of::<SharedMemoryData>() == 12);
};

const _: () = {
    use std::mem::offset_of;

    assert!(offset_of!(HookInfo, hook_ver_major) == 0);
    assert!(offset_of!(HookInfo, capture_type) == 8);
    assert!(offset_of!(HookInfo, cx) == 20);
    assert!(offset_of!(HookInfo, cy) == 24);
    assert!(offset_of!(HookInfo, map_size) == 44);
    assert!(offset_of!(HookInfo, flip) == 48);
    assert!(offset_of!(HookInfo, frame_interval) == 56);
    assert!(offset_of!(HookInfo, force_shmem) == 65);
    assert!(offset_of!(HookInfo, offsets) == 68);
    assert!(offset_of!(HookInfo, reserved) == 144);
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_capture_type_is_rejected_rather_than_transmuted() {
        let mut info = HookInfo {
            capture_type: 7,
            ..Default::default()
        };
        assert_eq!(info.capture_type(), None);

        info.capture_type = 1;
        assert_eq!(info.capture_type(), Some(CaptureType::Texture));
    }

    #[test]
    fn only_the_major_version_has_to_match() {
        let mut info = HookInfo {
            hook_ver_major: HOOK_VER_MAJOR,
            hook_ver_minor: HOOK_VER_MINOR + 3,
            ..Default::default()
        };
        assert!(info.version_matches(), "a newer minor is still compatible");

        info.hook_ver_major = HOOK_VER_MAJOR + 1;
        assert!(!info.version_matches());
    }

    #[test]
    fn a_fresh_info_block_asks_for_the_texture_path() {
        assert!(!HookInfo::default().force_shmem);
    }
}
