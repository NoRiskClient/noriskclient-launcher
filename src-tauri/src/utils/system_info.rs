use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::fmt::Display;

#[derive(Deserialize, PartialEq, Eq, Hash, Debug)]
pub enum OperatingSystem {
    #[serde(rename = "windows")]
    WINDOWS,
    #[serde(rename = "linux")]
    LINUX,
    #[serde(rename = "osx")]
    OSX,
    #[serde(rename = "unknown")]
    UNKNOWN,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Architecture {
    #[serde(rename = "x86")]
    X86,
    #[serde(rename = "x64")]
    X64,
    #[serde(rename = "arm")]
    ARM,
    #[serde(rename = "aarch64")]
    AARCH64,
    #[serde(rename = "unknown")]
    UNKNOWN,
}

impl OperatingSystem {
    pub fn get_path_separator(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::WINDOWS => ";",
            OperatingSystem::LINUX | OperatingSystem::OSX => ":",
            _ => return Err(AppError::JavaDownload("Invalid OS".to_string())),
        })
    }

    pub fn get_simple_name(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::WINDOWS => "windows",
            OperatingSystem::LINUX => "linux",
            OperatingSystem::OSX => "osx",
            _ => return Err(AppError::JavaDownload("Invalid OS".to_string())),
        })
    }

    pub fn get_adoptium_name(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::WINDOWS => "windows",
            OperatingSystem::LINUX => "linux",
            OperatingSystem::OSX => "mac",
            _ => return Err(AppError::JavaDownload("Invalid OS".to_string())),
        })
    }

    pub fn get_graal_name(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::WINDOWS => "windows",
            OperatingSystem::LINUX => "linux",
            OperatingSystem::OSX => "macos",
            _ => return Err(AppError::JavaDownload("Invalid OS".to_string())),
        })
    }

    pub fn get_archive_type(&self) -> Result<&'static str> {
        Ok(match self {
            OperatingSystem::WINDOWS => "zip",
            OperatingSystem::LINUX | OperatingSystem::OSX => "tar.gz",
            _ => return Err(AppError::JavaDownload("Invalid OS".to_string())),
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
            Architecture::ARM => "arm",
            Architecture::AARCH64 => "aarch64",
            _ => return Err(AppError::JavaDownload("Invalid architecture".to_string())),
        })
    }
}

impl Display for Architecture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.get_simple_name().unwrap())
    }
}

pub const OS: OperatingSystem = if cfg!(target_os = "windows") {
    OperatingSystem::WINDOWS
} else if cfg!(target_os = "macos") {
    OperatingSystem::OSX
} else if cfg!(any(target_os = "linux", target_os = "android")) {
    // Android is Linux-based: it uses the same piston library classifiers
    // and path separators. Native libs are swapped for the Pojav fork at
    // launch time (see mobile::launch), so linux-native entries are harmless.
    OperatingSystem::LINUX
} else {
    OperatingSystem::UNKNOWN
};

pub const ARCHITECTURE: Architecture = if cfg!(target_arch = "x86") {
    Architecture::X86
} else if cfg!(target_arch = "x86_64") {
    Architecture::X64
} else if cfg!(target_arch = "arm") {
    Architecture::ARM
} else if cfg!(target_arch = "aarch64") {
    Architecture::AARCH64
} else {
    Architecture::UNKNOWN
};
