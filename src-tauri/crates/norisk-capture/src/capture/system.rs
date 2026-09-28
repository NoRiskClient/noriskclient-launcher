use windows::core::{Interface, HSTRING};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

const NVIDIA: u32 = 0x10DE;

#[derive(Debug, Clone)]
pub struct Gpu {
    pub name: String,
    pub vendor: u32,
    pub driver: Option<String>,
    pub memory_mb: u64,
}

pub fn gpus() -> Vec<Gpu> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };

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

        let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
        let umd = unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }.ok();

        found.push(Gpu {
            name: String::from_utf16_lossy(&desc.Description[..end]),
            vendor: desc.VendorId,
            driver: umd.map(|umd| driver_version(umd as u64, desc.VendorId)),
            memory_mb: desc.DedicatedVideoMemory as u64 / (1024 * 1024),
        });
    }
    found
}

fn driver_version(umd: u64, vendor: u32) -> String {
    let parts = [umd >> 48, (umd >> 32) & 0xFFFF, (umd >> 16) & 0xFFFF, umd & 0xFFFF];
    let full = format!("{}.{}.{}.{}", parts[0], parts[1], parts[2], parts[3]);
    if vendor != NVIDIA {
        return full;
    }
    let release = (parts[2] % 10) * 10_000 + parts[3];
    format!("{} ({}.{:02})", full, release / 100, release % 100)
}

fn windows_version() -> String {
    const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

    let text = |value: &str| -> Option<String> {
        let mut buffer = [0u16; 128];
        let mut size = (buffer.len() * 2) as u32;
        unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                &HSTRING::from(KEY),
                &HSTRING::from(value),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end]))
    };
    let number = |value: &str| -> Option<u32> {
        let mut data = 0u32;
        let mut size = 4u32;
        unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                &HSTRING::from(KEY),
                &HSTRING::from(value),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut data as *mut u32 as *mut _),
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;
        Some(data)
    };

    let build = text("CurrentBuild").unwrap_or_else(|| "?".into());
    let family = match build.parse::<u32>() {
        Ok(number) if number >= 22_000 => "Windows 11",
        Ok(_) => "Windows 10",
        Err(_) => "Windows",
    };
    let patch = number("UBR").map(|ubr| format!(".{ubr}")).unwrap_or_default();
    let release = text("DisplayVersion").map(|name| format!(" ({name})")).unwrap_or_default();
    format!("{family} build {build}{patch}{release}")
}

fn ffmpeg_version() -> String {
    unsafe {
        let version = ffmpeg_next::ffi::av_version_info();
        if version.is_null() {
            return "unknown".into();
        }
        std::ffi::CStr::from_ptr(version).to_string_lossy().into_owned()
    }
}

pub fn log_system(gpus: &[Gpu]) {
    log::info!("System: {}, FFmpeg {}", windows_version(), ffmpeg_version());
    for gpu in gpus {
        log::info!(
            "Graphics card: {} ({} MB), driver {}",
            gpu.name,
            gpu.memory_mb,
            gpu.driver.as_deref().unwrap_or("unknown")
        );
    }
    for (number, screen) in super::screen::screens().iter().enumerate() {
        log::info!(
            "Monitor {}: {}x{} at {}%{} ({})",
            number + 1,
            screen.width,
            screen.height,
            screen.scale_percent,
            if screen.primary { " (primary)" } else { "" },
            screen.device
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn umd(parts: [u64; 4]) -> u64 {
        (parts[0] << 48) | (parts[1] << 32) | (parts[2] << 16) | parts[3]
    }

    #[test]
    fn an_nvidia_driver_is_shown_the_way_nvidia_names_it() {
        assert_eq!(driver_version(umd([32, 0, 15, 9597]), NVIDIA), "32.0.15.9597 (595.97)");
        assert_eq!(driver_version(umd([31, 0, 15, 5222]), NVIDIA), "31.0.15.5222 (552.22)");
        assert_eq!(driver_version(umd([32, 0, 15, 7005]), NVIDIA), "32.0.15.7005 (570.05)");
    }

    #[test]
    fn other_drivers_keep_their_plain_version() {
        assert_eq!(driver_version(umd([31, 0, 24033, 1003]), 0x1002), "31.0.24033.1003");
    }
}
