use anyhow::{bail, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use sysinfo::{RefreshKind, System, SystemExt};

/// Get the total memory of the system in bytes
pub fn total_memory() -> u64 {
    let sys = System::new_with_specifics(RefreshKind::new().with_memory());

    sys.total_memory()
}

pub const OS: OperatingSystem = if cfg!(target_os = "windows") {
    OperatingSystem::Windows
} else if cfg!(target_os = "macos") {
    OperatingSystem::Osx
} else if cfg!(target_os = "linux") {
    OperatingSystem::Linux
} else {
    OperatingSystem::Unkown
};

pub fn is_rosetta() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sysctl")
            .arg("sysctl.proc_translated")
            .output()
        {
            debug!(
                "Rosetta Output: {:?}",
                String::from_utf8_lossy(&output.stdout)
            );
            return String::from_utf8_lossy(&output.stdout).contains("1");
        }
    }
    false
}

pub fn get_architecture() -> Architecture {
    match () {
        () if cfg!(target_arch = "x86") => Architecture::X86,
        () if cfg!(target_arch = "x86_64") => {
            if is_rosetta() {
                Architecture::Aarch64
            } else {
                Architecture::X64
            }
        }
        () if cfg!(target_arch = "arm") => Architecture::Arm,
        () if cfg!(target_arch = "aarch64") => Architecture::Aarch64,
        () => Architecture::Unknown,
    }
}

pub const OS_VERSION: Lazy<String> = Lazy::new(|| os_info::get().version().to_string());

#[derive(Deserialize, PartialEq, Eq, Hash, Debug)]
pub enum OperatingSystem {
    #[serde(rename = "windows")]
    Windows,
    #[serde(rename = "linux")]
    Linux,
    #[serde(rename = "osx")]
    Osx,
    #[serde(rename = "unknown")]
    Unkown,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Architecture {
    #[serde(rename = "x86")]
    X86,
    #[serde(rename = "x64")]
    X64,
    #[serde(rename = "arm")]
    Arm,
    #[serde(rename = "aarch64")]
    Aarch64,
    #[serde(rename = "unknown")]
    Unknown,
}

impl OperatingSystem {
    pub fn get_path_separator(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::Windows => ";",
            OperatingSystem::Linux | OperatingSystem::Osx => ":",
            OperatingSystem::Unkown => bail!("Invalid OS"),
        })
    }

    pub fn get_simple_name(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::Windows => "windows",
            OperatingSystem::Linux => "linux",
            OperatingSystem::Osx => "osx",
            OperatingSystem::Unkown => bail!("Invalid OS"),
        })
    }

    pub fn get_adoptium_name(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::Windows => "windows",
            OperatingSystem::Linux => "linux",
            OperatingSystem::Osx => "mac",
            OperatingSystem::Unkown => bail!("Invalid OS"),
        })
    }
}

impl Display for OperatingSystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.get_simple_name().unwrap())
    }
}

impl Architecture {
    pub fn get_simple_name(&self) -> Result<&'static str> {
        Ok(match self {
            Architecture::X86 => "x86",
            Architecture::X64 => "x64",
            Architecture::Arm => "arm",
            Architecture::Aarch64 => "aarch64",
            Architecture::Unknown => bail!("Invalid architecture"),
        })
    }
}

impl Display for Architecture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.get_simple_name().unwrap())
    }
}
