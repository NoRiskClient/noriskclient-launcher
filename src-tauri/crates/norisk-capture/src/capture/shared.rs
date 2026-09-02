use anyhow::{Context, Result};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Texture2D, D3D11_TEXTURE2D_DESC,
};

pub fn open_shared_texture(device: &ID3D11Device, handle: u32) -> Result<ID3D11Texture2D> {
    if handle == 0 {
        anyhow::bail!("the hook has not published a texture handle yet");
    }

    let raw = HANDLE(handle as isize as *mut std::ffi::c_void);

    let mut texture: Option<ID3D11Texture2D> = None;
    unsafe {
        device
            .OpenSharedResource(raw, &mut texture)
            .with_context(|| format!("OpenSharedResource failed for handle {handle:#x}"))?;
    }

    texture.with_context(|| format!("OpenSharedResource returned nothing for handle {handle:#x}"))
}

pub fn describe(texture: &ID3D11Texture2D) -> D3D11_TEXTURE2D_DESC {
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    desc
}

