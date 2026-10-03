use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
use windows::core::PCSTR;
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Buffer, ID3D11PixelShader, ID3D11RenderTargetView, ID3D11SamplerState,
    ID3D11ShaderResourceView, ID3D11Texture2D, ID3D11VertexShader, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_COMPARISON_NEVER, D3D11_FILTER_MIN_MAG_MIP_POINT,
    D3D11_SAMPLER_DESC, D3D11_TEXTURE2D_DESC, D3D11_TEXTURE_ADDRESS_CLAMP, D3D11_VIEWPORT,
};

use super::device::CaptureDevice;

const MAX_CACHED_VIEWS: usize = 64;

const SHADER: &str = r#"
struct Vertex {
    float4 position : SV_Position;
    float2 uv : TEXCOORD0;
};

Vertex vertex_main(uint id : SV_VertexID) {
    float2 corner = float2((id << 1) & 2, id & 2);

    Vertex out_vertex;
    out_vertex.position = float4(corner * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
    out_vertex.uv = float2(corner.x, 1.0 - corner.y);
    return out_vertex;
}

Texture2D source : register(t0);
SamplerState point_clamp : register(s0);

float4 pixel_main(Vertex in_vertex) : SV_Target {
    return source.Sample(point_clamp, in_vertex.uv);
}
"#;

pub struct Flipper {
    device: CaptureDevice,
    vertex: ID3D11VertexShader,
    pixel: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    target: Mutex<Option<Target>>,
    sources: Mutex<HashMap<usize, ID3D11ShaderResourceView>>,
}

struct Target {
    size: (u32, u32),
    format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    texture: ID3D11Texture2D,
    view: ID3D11RenderTargetView,
}

unsafe impl Send for Flipper {}
unsafe impl Sync for Flipper {}

impl Flipper {
    pub fn new(device: &CaptureDevice) -> Result<Self> {
        let vertex_code = compile(SHADER, "vertex_main", "vs_4_0")?;
        let pixel_code = compile(SHADER, "pixel_main", "ps_4_0")?;

        let mut vertex = None;
        let mut pixel = None;
        let mut sampler = None;

        unsafe {
            device
                .device
                .CreateVertexShader(&vertex_code, None, Some(&mut vertex))
                .context("CreateVertexShader failed")?;
            device
                .device
                .CreatePixelShader(&pixel_code, None, Some(&mut pixel))
                .context("CreatePixelShader failed")?;

            let desc = D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_MIN_MAG_MIP_POINT,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                ComparisonFunc: D3D11_COMPARISON_NEVER,
                MaxLOD: f32::MAX,
                ..Default::default()
            };
            device
                .device
                .CreateSamplerState(&desc, Some(&mut sampler))
                .context("CreateSamplerState failed")?;
        }

        Ok(Self {
            device: device.clone(),
            vertex: vertex.ok_or_else(|| anyhow!("no vertex shader"))?,
            pixel: pixel.ok_or_else(|| anyhow!("no pixel shader"))?,
            sampler: sampler.ok_or_else(|| anyhow!("no sampler"))?,
            target: Mutex::new(None),
            sources: Mutex::new(HashMap::new()),
        })
    }

    pub fn flip(&self, source: &ID3D11Texture2D, size: (u32, u32)) -> Result<ID3D11Texture2D> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { source.GetDesc(&mut desc) };

        let mut target = self.target.lock().unwrap_or_else(|e| e.into_inner());
        let stale = match target.as_ref() {
            Some(existing) => existing.size != size || existing.format != desc.Format,
            None => true,
        };
        if stale {
            *target = Some(self.make_target(size, desc.Format)?);
            self.sources.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }
        let target = target.as_ref().expect("the target was just built");

        let view = self.source_view(source)?;
        let context = &self.device.context;
        let _alone = Alone::new(&self.device);

        unsafe {
            context.RSSetState(None);
            context.OMSetBlendState(None, None, u32::MAX);
            context.OMSetDepthStencilState(None, 0);
            context.GSSetShader(None, None);
            context.HSSetShader(None, None);
            context.DSSetShader(None, None);
            context.OMSetRenderTargets(Some(&[Some(target.view.clone())]), None);
            context.RSSetViewports(Some(&[D3D11_VIEWPORT {
                TopLeftX: 0.0,
                TopLeftY: 0.0,
                Width: size.0 as f32,
                Height: size.1 as f32,
                MinDepth: 0.0,
                MaxDepth: 1.0,
            }]));

            context.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            context.IASetInputLayout(None);
            context.IASetVertexBuffers(0, 1, Some(&None::<ID3D11Buffer>), Some(&0), Some(&0));

            context.VSSetShader(&self.vertex, None);
            context.PSSetShader(&self.pixel, None);
            context.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            context.PSSetShaderResources(0, Some(&[Some(view)]));

            context.Draw(3, 0);

            context.PSSetShaderResources(0, Some(&[None]));
            context.OMSetRenderTargets(None, None);
        }

        Ok(target.texture.clone())
    }

    fn make_target(
        &self,
        size: (u32, u32),
        format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    ) -> Result<Target> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: size.0,
            Height: size.1,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            ..Default::default()
        };

        let mut texture = None;
        unsafe {
            self.device
                .device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .context("could not make a texture to flip into")?;
        }
        let texture: ID3D11Texture2D = texture.ok_or_else(|| anyhow!("no flip texture"))?;

        let mut view = None;
        unsafe {
            self.device
                .device
                .CreateRenderTargetView(&texture, None, Some(&mut view))
                .context("CreateRenderTargetView failed")?;
        }

        log::info!(
            "Flipping {}x{} the right way up in a shader",
            size.0,
            size.1
        );

        Ok(Target {
            size,
            format,
            texture,
            view: view.ok_or_else(|| anyhow!("no render target view"))?,
        })
    }

    fn source_view(&self, source: &ID3D11Texture2D) -> Result<ID3D11ShaderResourceView> {
        use windows::core::Interface;

        let key = source.as_raw() as usize;
        let mut sources = self.sources.lock().unwrap_or_else(|e| e.into_inner());

        if sources.len() > MAX_CACHED_VIEWS {
            sources.clear();
        }
        if let Some(view) = sources.get(&key) {
            return Ok(view.clone());
        }

        let mut view = None;
        unsafe {
            self.device
                .device
                .CreateShaderResourceView(source, None, Some(&mut view))
                .context("the hook's texture cannot be read by a shader")?;
        }
        let view: ID3D11ShaderResourceView = view.ok_or_else(|| anyhow!("no source view"))?;

        sources.insert(key, view.clone());
        Ok(view)
    }
}

struct Alone(Option<windows::Win32::Graphics::Direct3D11::ID3D11Multithread>);

impl Alone {
    fn new(device: &CaptureDevice) -> Self {
        use windows::core::Interface;

        let lock = device.context.cast::<windows::Win32::Graphics::Direct3D11::ID3D11Multithread>().ok();
        if let Some(lock) = lock.as_ref() {
            unsafe { lock.Enter() };
        }
        Self(lock)
    }
}

impl Drop for Alone {
    fn drop(&mut self) {
        if let Some(lock) = self.0.as_ref() {
            unsafe { lock.Leave() };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_CPU_ACCESS_READ, D3D11_MAP_READ, D3D11_SUBRESOURCE_DATA, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

    const WIDTH: u32 = 4;
    const HEIGHT: u32 = 4;

    #[test]
    #[ignore = "needs a real graphics device"]
    fn the_shader_turns_a_picture_upside_down() {
        let device = CaptureDevice::new_default().expect("a graphics device");
        let flipper = Flipper::new(&device).expect("the flip shader builds");

        let rows: Vec<u8> = (0..HEIGHT)
            .flat_map(|row| {
                let shade = (row as u8 + 1) * 40;
                std::iter::repeat([shade, shade, shade, 255])
                    .take(WIDTH as usize)
                    .flatten()
            })
            .collect();

        let source = texture(&device, &rows);
        let flipped = flipper.flip(&source, (WIDTH, HEIGHT)).expect("the flip runs");
        let out = read_back(&device, &flipped);

        let shade_of = |data: &[u8], row: u32| data[(row * WIDTH * 4) as usize];
        for row in 0..HEIGHT {
            assert_eq!(
                shade_of(&out, row),
                shade_of(&rows, HEIGHT - 1 - row),
                "row {row} should hold what row {} held before",
                HEIGHT - 1 - row
            );
        }
    }

    fn texture(device: &CaptureDevice, pixels: &[u8]) -> ID3D11Texture2D {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: WIDTH,
            Height: HEIGHT,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            ..Default::default()
        };
        let data = D3D11_SUBRESOURCE_DATA {
            pSysMem: pixels.as_ptr() as *const _,
            SysMemPitch: WIDTH * 4,
            SysMemSlicePitch: 0,
        };

        let mut texture = None;
        unsafe {
            device
                .device
                .CreateTexture2D(&desc, Some(&data), Some(&mut texture))
                .expect("the source texture");
        }
        texture.expect("a source texture")
    }

    fn read_back(device: &CaptureDevice, source: &ID3D11Texture2D) -> Vec<u8> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: WIDTH,
            Height: HEIGHT,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            ..Default::default()
        };

        let mut staging = None;
        unsafe {
            device
                .device
                .CreateTexture2D(&desc, None, Some(&mut staging))
                .expect("a staging texture");
        }
        let staging: ID3D11Texture2D = staging.expect("a staging texture");

        let mut out = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
        unsafe {
            device.context.CopyResource(&staging, source);
            let mut mapped = Default::default();
            device
                .context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .expect("the staging texture maps");

            for row in 0..HEIGHT as usize {
                let from = (mapped.pData as *const u8).add(row * mapped.RowPitch as usize);
                let to = &mut out[row * WIDTH as usize * 4..][..WIDTH as usize * 4];
                std::ptr::copy_nonoverlapping(from, to.as_mut_ptr(), to.len());
            }

            device.context.Unmap(&staging, 0);
        }
        out
    }
}

fn compile(source: &str, entry: &str, profile: &str) -> Result<Vec<u8>> {
    let entry = std::ffi::CString::new(entry).context("entry point has an interior nul")?;
    let profile = std::ffi::CString::new(profile).context("profile has an interior nul")?;

    let mut code = None;
    let mut errors = None;

    let result = unsafe {
        D3DCompile(
            source.as_ptr() as *const _,
            source.len(),
            PCSTR::null(),
            None,
            None,
            PCSTR(entry.as_ptr() as *const u8),
            PCSTR(profile.as_ptr() as *const u8),
            0,
            0,
            &mut code,
            Some(&mut errors),
        )
    };

    if let Err(e) = result {
        let detail = errors
            .and_then(|blob| unsafe {
                let text = std::slice::from_raw_parts(
                    blob.GetBufferPointer() as *const u8,
                    blob.GetBufferSize(),
                );
                Some(String::from_utf8_lossy(text).trim().to_string())
            })
            .unwrap_or_default();
        return Err(anyhow!("compiling the flip shader failed: {e} {detail}"));
    }

    let code = code.ok_or_else(|| anyhow!("the flip shader compiled to nothing"))?;
    Ok(unsafe {
        std::slice::from_raw_parts(code.GetBufferPointer() as *const u8, code.GetBufferSize())
            .to_vec()
    })
}
