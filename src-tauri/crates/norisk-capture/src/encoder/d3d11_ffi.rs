use std::ffi::c_void;

#[repr(C)]
pub struct ID3D11Device {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct ID3D11DeviceContext {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct ID3D11VideoDevice {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct ID3D11VideoContext {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct ID3D11Texture2D {
    _opaque: [u8; 0],
}

#[repr(C)]
pub struct AVD3D11VADeviceContext {
    pub device: *mut ID3D11Device,
    pub device_context: *mut ID3D11DeviceContext,
    pub video_device: *mut ID3D11VideoDevice,
    pub video_context: *mut ID3D11VideoContext,
    pub lock: Option<unsafe extern "C" fn(lock_ctx: *mut c_void)>,
    pub unlock: Option<unsafe extern "C" fn(lock_ctx: *mut c_void)>,
    pub lock_ctx: *mut c_void,
    pub bind_flags: u32,
    pub misc_flags: u32,
}

#[repr(C)]
pub struct AVD3D11FrameDescriptor {
    pub texture: *mut ID3D11Texture2D,
    pub index: isize,
}

#[repr(C)]
pub struct AVD3D11VAFramesContext {
    pub texture: *mut ID3D11Texture2D,
    pub bind_flags: u32,
    pub misc_flags: u32,
    pub texture_infos: *mut AVD3D11FrameDescriptor,
}

const _: () = {
    use std::mem::{align_of, offset_of, size_of};

    assert!(size_of::<AVD3D11VADeviceContext>() == 64);
    assert!(align_of::<AVD3D11VADeviceContext>() == 8);
    assert!(offset_of!(AVD3D11VADeviceContext, device) == 0);
    assert!(offset_of!(AVD3D11VADeviceContext, device_context) == 8);
    assert!(offset_of!(AVD3D11VADeviceContext, video_device) == 16);
    assert!(offset_of!(AVD3D11VADeviceContext, video_context) == 24);
    assert!(offset_of!(AVD3D11VADeviceContext, lock) == 32);
    assert!(offset_of!(AVD3D11VADeviceContext, unlock) == 40);
    assert!(offset_of!(AVD3D11VADeviceContext, lock_ctx) == 48);
    assert!(offset_of!(AVD3D11VADeviceContext, bind_flags) == 56);
    assert!(offset_of!(AVD3D11VADeviceContext, misc_flags) == 60);

    assert!(size_of::<AVD3D11FrameDescriptor>() == 16);
    assert!(offset_of!(AVD3D11FrameDescriptor, texture) == 0);
    assert!(offset_of!(AVD3D11FrameDescriptor, index) == 8);

    assert!(size_of::<AVD3D11VAFramesContext>() == 24);
    assert!(align_of::<AVD3D11VAFramesContext>() == 8);
    assert!(offset_of!(AVD3D11VAFramesContext, texture) == 0);
    assert!(offset_of!(AVD3D11VAFramesContext, bind_flags) == 8);
    assert!(offset_of!(AVD3D11VAFramesContext, misc_flags) == 12);
    assert!(offset_of!(AVD3D11VAFramesContext, texture_infos) == 16);
};

const _: () = {
    assert!(
        std::mem::size_of::<Option<unsafe extern "C" fn(*mut c_void)>>()
            == std::mem::size_of::<*mut c_void>()
    );
};
