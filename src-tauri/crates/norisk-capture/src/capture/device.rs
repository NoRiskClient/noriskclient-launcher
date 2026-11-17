use anyhow::{anyhow, Context, Result};
use windows::core::Interface;
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Win32::Foundation::{HWND, LUID};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_FLAG, D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
    D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1,
    DXGI_ADAPTER_DESC1, DXGI_ADAPTER_FLAG_SOFTWARE,
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

    pub fn new_for_monitor(monitor: HMONITOR) -> Result<Self> {
        let (adapter, adapter_name) = adapter_for_monitor(monitor)?;
        Self::create(adapter, adapter_name)
    }

    pub fn new_default() -> Result<Self> {
        let (adapter, desc) = hardware_adapters()?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("no hardware graphics adapter found"))?;
        Self::create(adapter.cast()?, super::utf16_to_string(&desc.Description))
    }

    pub fn new_for_shared_texture(hwnd: HWND, handle: u32) -> Result<Self> {
        let first = Self::new_for_window(hwnd)?;
        let refused = match super::shared::open_shared_texture(&first.device, handle) {
            Ok(_) => return Ok(first),
            Err(e) => e,
        };

        let tried = adapter_luid(&first.device);
        for (adapter, desc) in hardware_adapters()? {
            if tried == Some(desc.AdapterLuid) {
                continue;
            }
            let Ok(adapter) = adapter.cast() else {
                continue;
            };
            let Ok(device) = Self::create(adapter, super::utf16_to_string(&desc.Description)) else {
                continue;
            };
            if super::shared::open_shared_texture(&device.device, handle).is_ok() {
                log::info!(
                    "The game draws on '{}', not on '{}' which drives its monitor; recording there",
                    device.adapter_name,
                    first.adapter_name
                );
                return Ok(device);
            }
        }

        Err(refused.context("no graphics card in this computer could open the game's image"))
    }

    fn create(adapter: IDXGIAdapter, adapter_name: String) -> Result<Self> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let mut level = D3D_FEATURE_LEVEL::default();

        unsafe {
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                None,
                CREATE_FLAGS,
                Some(&FEATURE_LEVELS),
                D3D11_SDK_VERSION,
                Some(&mut device),
                Some(&mut level),
                Some(&mut context),
            )
            .with_context(|| refusal(&adapter, &adapter_name))?;
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

        log::info!("Capture device created on adapter: {adapter_name} at {}", name_of(level));

        Ok(Self {
            device,
            context,
            winrt_device,
            adapter_name,
        })
    }
}

const CREATE_FLAGS: D3D11_CREATE_DEVICE_FLAG =
    D3D11_CREATE_DEVICE_FLAG(D3D11_CREATE_DEVICE_BGRA_SUPPORT.0 | D3D11_CREATE_DEVICE_VIDEO_SUPPORT.0);

const FEATURE_LEVELS: [D3D_FEATURE_LEVEL; 2] = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0];

fn name_of(level: D3D_FEATURE_LEVEL) -> &'static str {
    match level {
        D3D_FEATURE_LEVEL_11_1 => "feature level 11.1",
        D3D_FEATURE_LEVEL_11_0 => "feature level 11.0",
        _ => "an unexpected feature level",
    }
}

fn refusal(adapter: &IDXGIAdapter, name: &str) -> String {
    let mut probe: Option<ID3D11Device> = None;
    let plain = D3D11_CREATE_DEVICE_FLAG(D3D11_CREATE_DEVICE_BGRA_SUPPORT.0);

    let without_video = unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            None,
            plain,
            Some(&FEATURE_LEVELS),
            D3D11_SDK_VERSION,
            Some(&mut probe),
            None,
            None,
        )
    };

    if without_video.is_ok() {
        format!(
            "'{name}' speaks Direct3D 11 but its driver offers no video support, \
             which recording needs — a driver update usually fixes this"
        )
    } else {
        format!("'{name}' supports neither Direct3D feature level 11.1 nor 11.0")
    }
}

pub(super) fn hardware_adapters() -> Result<Vec<(IDXGIAdapter1, DXGI_ADAPTER_DESC1)>> {
    let factory: IDXGIFactory1 =
        unsafe { CreateDXGIFactory1().context("CreateDXGIFactory1 failed")? };

    let mut found = Vec::new();
    for i in 0.. {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(i) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        found.push((adapter, desc));
    }
    Ok(found)
}

fn adapter_luid(device: &ID3D11Device) -> Option<LUID> {
    let dxgi_device: IDXGIDevice = device.cast().ok()?;
    let adapter = unsafe { dxgi_device.GetAdapter() }.ok()?;
    Some(unsafe { adapter.GetDesc() }.ok()?.AdapterLuid)
}

fn adapter_for_monitor(monitor: HMONITOR) -> Result<(IDXGIAdapter, String)> {
    let mut first_hardware: Option<(IDXGIAdapter, String)> = None;

    for (adapter, desc) in hardware_adapters()? {
        let name = super::utf16_to_string(&desc.Description);
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
