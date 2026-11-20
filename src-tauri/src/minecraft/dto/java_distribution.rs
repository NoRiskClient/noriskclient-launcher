use crate::error::{AppError, Result};
use crate::utils::system_info::{ARCHITECTURE, OS};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, PartialEq)]
pub enum JavaDistribution {
    #[serde(rename = "temurin")]
    Temurin,
    #[serde(rename = "graalvm")]
    GraalVM,
    #[serde(rename = "zulu")]
    Zulu,
}

impl Default for JavaDistribution {
    fn default() -> Self {
        // Temurin supports any version of java
        JavaDistribution::Temurin
    }
}

// JSON response structure from Zulu API
#[derive(Deserialize)]
pub struct ZuluApiResponse {
    pub url: String,
}

impl JavaDistribution {
    pub fn get_url(&self, jre_version: &u32, force_x86_64: bool) -> Result<String> {
        // Get the appropriate architecture
        let os_arch = if force_x86_64 {
            "x64" // Force x64 architecture for legacy compatibility
        } else {
            ARCHITECTURE.get_simple_name()?
        };

        let archive_type = OS.get_archive_type()?;

        Ok(match self {
            JavaDistribution::Temurin => {
                let os_name = OS.get_adoptium_name()?;
                format!(
                    "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jre/hotspot/normal/eclipse?project=jdk",
                    jre_version, os_name, os_arch
                )
            }
            JavaDistribution::GraalVM => {
                let os_name = OS.get_graal_name()?;

                if jre_version > &17 {
                    format!(
                        "https://download.oracle.com/graalvm/{}/latest/graalvm-jdk-{}_{}-{}_bin.{}",
                        jre_version, jre_version, os_name, os_arch, archive_type
                    )
                } else if jre_version == &17 {
                    // Use archive link for 17.0.12
                    format!(
                        "https://download.oracle.com/graalvm/17/archive/graalvm-jdk-17.0.12_{}-{}_bin.{}",
                        os_name, os_arch, archive_type
                    )
                } else {
                    return Err(AppError::JavaDownload(
                        "GraalVM only supports Java 17+".to_string(),
                    ));
                }
            }
            JavaDistribution::Zulu => {
                // Map architecture to Zulu format
                let zulu_arch = match os_arch {
                    "x64" => "x64",
                    "aarch64" => "aarch64",
                    "arm" => "arm32-vfp-hflt",
                    _ => {
                        return Err(AppError::JavaDownload(format!(
                            "Zulu does not support {} architecture",
                            os_arch
                        )))
                    }
                };

                // Map OS to Zulu format
                let zulu_os = match OS {
                    crate::utils::system_info::OperatingSystem::WINDOWS => "win",
                    crate::utils::system_info::OperatingSystem::LINUX => "linux",
                    crate::utils::system_info::OperatingSystem::OSX => "macosx",
                    _ => {
                        return Err(AppError::JavaDownload(
                            "Unsupported OS for Zulu Java".to_string(),
                        ))
                    }
                };

                // This is the API endpoint that returns JSON with the actual download URL
                format!(
                    "https://api.azul.com/zulu/download/community/v1.0/bundles/latest/?jdk_version={}&bundle_type=jre&ext={}&arch={}&os={}",
                    jre_version, 
                    if zulu_os == "win" { "zip" } else { "tar.gz" },
                    zulu_arch,
                    zulu_os
                )
            }
        })
    }

    pub fn requires_api_response(&self) -> bool {
        match self {
            JavaDistribution::Zulu => true,
            _ => false,
        }
    }

    pub fn get_name(&self) -> &str {
        match self {
            JavaDistribution::Temurin => "temurin",
            JavaDistribution::GraalVM => "graalvm",
            JavaDistribution::Zulu => "zulu",
        }
    }

}
