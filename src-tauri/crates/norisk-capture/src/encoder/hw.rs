use std::ptr;

use anyhow::{anyhow, bail, Result};
use ffmpeg_next::ffi as ff;
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Texture2D, D3D11_BIND_RENDER_TARGET, D3D11_BIND_VIDEO_ENCODER,
};

use super::d3d11_ffi::{AVD3D11VADeviceContext, AVD3D11VAFramesContext};
use crate::capture::CaptureDevice;


pub struct HwFramePool {
    device_ctx: *mut ff::AVBufferRef,
    frames_ctx: *mut ff::AVBufferRef,
    width: u32,
    height: u32,
}

unsafe impl Send for HwFramePool {}
unsafe impl Sync for HwFramePool {}

impl HwFramePool {
    pub fn new(device: &CaptureDevice, width: u32, height: u32) -> Result<Self> {
        if width == 0 || height == 0 {
            bail!("frame pool needs a non-zero size, got {width}x{height}");
        }

        let device_ctx = unsafe { create_device_context(device)? };

        let candidates: [(u32, &str); 3] = [
            (
                (D3D11_BIND_VIDEO_ENCODER.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
                "VIDEO_ENCODER | RENDER_TARGET",
            ),
            (D3D11_BIND_RENDER_TARGET.0 as u32, "RENDER_TARGET"),
            (0, "none"),
        ];

        let mut frames_ctx = None;
        let mut last_error = None;

        for (flags, label) in candidates {
            match unsafe { create_frames_context(device_ctx, width, height, flags) } {
                Ok(ctx) => {
                    log::info!("Hardware frame pool bind flags: {label}");
                    frames_ctx = Some(ctx);
                    break;
                }
                Err(e) => {
                    log::debug!("Bind flags '{label}' rejected: {e:#}");
                    last_error = Some(e);
                }
            }
        }

        let Some(frames_ctx) = frames_ctx else {
            unsafe { ff::av_buffer_unref(&mut { device_ctx } as *mut _) };
            return Err(last_error
                .unwrap_or_else(|| anyhow!("no usable bind flags for an NV12 frame pool")));
        };

        log::info!("Hardware frame pool ready: {width}x{height} NV12, on-demand textures");

        Ok(Self {
            device_ctx,
            frames_ctx,
            width,
            height,
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn frames_ref(&self) -> Result<*mut ff::AVBufferRef> {
        let reference = unsafe { ff::av_buffer_ref(self.frames_ctx) };
        if reference.is_null() {
            bail!("av_buffer_ref on the frames context failed");
        }
        Ok(reference)
    }

    pub fn acquire(&self) -> Result<PoolFrame> {
        let frame = unsafe { ff::av_frame_alloc() };
        if frame.is_null() {
            bail!("av_frame_alloc failed");
        }

        let rc = unsafe { ff::av_hwframe_get_buffer(self.frames_ctx, frame, 0) };
        if rc < 0 {
            unsafe { ff::av_frame_free(&mut { frame } as *mut _) };
            bail!("av_hwframe_get_buffer failed: {}", av_error(rc));
        }

        let texture_ptr = unsafe { (*frame).data[0] };
        let slice = unsafe { (*frame).data[1] } as usize as u32;

        if texture_ptr.is_null() {
            unsafe { ff::av_frame_free(&mut { frame } as *mut _) };
            bail!("hardware frame carries no texture");
        }

        let texture_ptr = texture_ptr as *mut std::ffi::c_void;
        let texture = unsafe { ID3D11Texture2D::from_raw_borrowed(&texture_ptr) }
            .ok_or_else(|| anyhow!("hardware frame texture is not an ID3D11Texture2D"))?
            .clone();

        Ok(PoolFrame {
            frame,
            texture,
            slice,
        })
    }
}

impl Drop for HwFramePool {
    fn drop(&mut self) {
        unsafe {
            ff::av_buffer_unref(&mut self.frames_ctx);
            ff::av_buffer_unref(&mut self.device_ctx);
        }
    }
}

pub struct PoolFrame {
    frame: *mut ff::AVFrame,
    texture: ID3D11Texture2D,
    slice: u32,
}

unsafe impl Send for PoolFrame {}

impl PoolFrame {
    pub fn target(&self) -> (&ID3D11Texture2D, u32) {
        (&self.texture, self.slice)
    }

    pub fn as_ptr(&self) -> *mut ff::AVFrame {
        self.frame
    }

    pub fn set_pts(&mut self, pts: i64) {
        unsafe { (*self.frame).pts = pts };
    }
}

impl Drop for PoolFrame {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.frame) };
    }
}

unsafe fn create_device_context(device: &CaptureDevice) -> Result<*mut ff::AVBufferRef> {
    let buffer = ff::av_hwdevice_ctx_alloc(ff::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA);
    if buffer.is_null() {
        bail!("av_hwdevice_ctx_alloc failed — is D3D11VA compiled into this FFmpeg?");
    }

    let device_ctx = (*buffer).data as *mut ff::AVHWDeviceContext;
    let d3d11 = (*device_ctx).hwctx as *mut AVD3D11VADeviceContext;

    (*d3d11).device = device.device.clone().into_raw() as *mut _;

    let rc = ff::av_hwdevice_ctx_init(buffer);
    if rc < 0 {
        ff::av_buffer_unref(&mut { buffer } as *mut _);
        bail!("av_hwdevice_ctx_init failed: {}", av_error(rc));
    }

    Ok(buffer)
}

unsafe fn create_frames_context(
    device_ctx: *mut ff::AVBufferRef,
    width: u32,
    height: u32,
    bind_flags: u32,
) -> Result<*mut ff::AVBufferRef> {
    let buffer = ff::av_hwframe_ctx_alloc(device_ctx);
    if buffer.is_null() {
        bail!("av_hwframe_ctx_alloc failed");
    }

    let frames = (*buffer).data as *mut ff::AVHWFramesContext;
    (*frames).format = ff::AVPixelFormat::AV_PIX_FMT_D3D11;
    (*frames).sw_format = ff::AVPixelFormat::AV_PIX_FMT_NV12;
    (*frames).width = width as i32;
    (*frames).height = height as i32;
    (*frames).initial_pool_size = 0;

    let d3d11 = (*frames).hwctx as *mut AVD3D11VAFramesContext;
    (*d3d11).bind_flags = bind_flags;
    (*d3d11).misc_flags = 0;
    (*d3d11).texture = ptr::null_mut();

    let rc = ff::av_hwframe_ctx_init(buffer);
    if rc < 0 {
        ff::av_buffer_unref(&mut { buffer } as *mut _);
        bail!("av_hwframe_ctx_init failed: {}", av_error(rc));
    }

    Ok(buffer)
}

pub fn av_error(code: i32) -> String {
    let mut buffer = [0i8; ff::AV_ERROR_MAX_STRING_SIZE];
    unsafe {
        if ff::av_strerror(code, buffer.as_mut_ptr(), buffer.len()) < 0 {
            return format!("error {code}");
        }
        std::ffi::CStr::from_ptr(buffer.as_ptr())
            .to_string_lossy()
            .into_owned()
    }
}
