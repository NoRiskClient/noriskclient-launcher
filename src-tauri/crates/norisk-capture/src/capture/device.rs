use anyhow::{anyhow, Context, Result};
use windows::core::Interface;
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG,
    DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;

#[derive(Clone)]
pub struct CaptureDevice {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub winrt_device: IDirect3DDevice,
    pub adapter_name: String,
}

unsafe impl Send for CaptureDevice {}
unsafe impl Sync for CaptureDevice {}

impl CaptureDevice {
    pub fn new_for_window(hwnd: HWND) -> Result<Self> {
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let (adapter, adapter_name) = adapter_for_monitor(monitor)?;
        Self::create(adapter, adapter_name)
    }

    pub fn new_default() -> Result<Self> {
        let (adapter, adapter_name) = first_hardware_adapter()?;
        Self::create(adapter, adapter_name)
    }

    fn create(adapter: IDXGIAdapter, adapter_name: String) -> Result<Self> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;

        unsafe {
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .context("D3D11CreateDevice failed")?;
        }

        let device = device.ok_or_else(|| anyhow!("D3D11CreateDevice returned no device"))?;
        let context = context.ok_or_else(|| anyhow!("D3D11CreateDevice returned no context"))?;

        if let Ok(mt) = device.cast::<ID3D11Multithread>() {
            let _previously_protected = unsafe { mt.SetMultithreadProtected(true) };
        } else {
            log::warn!("ID3D11Multithread unavailable; context access is not runtime-serialised");
        }

        let dxgi_device: IDXGIDevice = device.cast().context("device is not an IDXGIDevice")?;
        let inspectable = unsafe {
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)
                .context("CreateDirect3D11DeviceFromDXGIDevice failed")?
        };
        let winrt_device: IDirect3DDevice = inspectable
            .cast()
            .context("WinRT device is not an IDirect3DDevice")?;

        log::info!("Capture device created on adapter: {adapter_name}");

        Ok(Self {
            device,
            context,
            winrt_device,
            adapter_name,
        })
    }
}

fn first_hardware_adapter() -> Result<(IDXGIAdapter, String)> {
    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1().context("CreateDXGIFactory1 failed")? };

    for i in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(i) }) else {
            break;
        };
        let desc = unsafe { adapter.GetDesc1() }.context("IDXGIAdapter1::GetDesc1 failed")?;
        if DXGI_ADAPTER_FLAG(desc.Flags as i32) == DXGI_ADAPTER_FLAG_SOFTWARE {
            continue;
        }
        return Ok((adapter.cast()?, utf16_to_string(&desc.Description)));
    }

    Err(anyhow!("no hardware graphics adapter found"))
}

fn adapter_for_monitor(monitor: HMONITOR) -> Result<(IDXGIAdapter, String)> {
    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1().context("CreateDXGIFactory1 failed")? };

    let mut first_hardware: Option<(IDXGIAdapter, String)> = None;

    for i in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(i) }) else {
            break;
        };

        let desc = unsafe { adapter.GetDesc1() }.context("IDXGIAdapter1::GetDesc1 failed")?;
        if DXGI_ADAPTER_FLAG(desc.Flags as i32) == DXGI_ADAPTER_FLAG_SOFTWARE {
            continue;
        }

        let name = utf16_to_string(&desc.Description);
        let generic: IDXGIAdapter = adapter.cast().context("adapter cast failed")?;

        if first_hardware.is_none() {
            first_hardware = Some((generic.clone(), name.clone()));
        }

        for j in 0.. {
            let Ok(output) = (unsafe { adapter.EnumOutputs(j) }) else {
                break;
            };
            let output_desc = unsafe { output.GetDesc() }.context("IDXGIOutput::GetDesc failed")?;
            if output_desc.Monitor == monitor {
                return Ok((generic, name));
            }
        }
    }

    first_hardware
        .map(|(adapter, name)| {
            log::warn!(
                "No adapter output matched the window's monitor; falling back to '{name}'. \
                 On a hybrid-GPU machine this may not be the GPU rendering the game."
            );
            (adapter, format!("{name} (no monitor match)"))
        })
        .ok_or_else(|| anyhow!("no hardware graphics adapter found"))
}

fn utf16_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}
