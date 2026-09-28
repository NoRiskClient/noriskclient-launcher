use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs;

const NATIVES_DIR: &str = "natives";
const COMPLETE_MARKER: &str = ".complete";
const NOTICE_FILE: &str = "NOTICE.txt";
const DIR_NAME_LEN: usize = 16;
const EXTRACT_REVISION: u32 = 4;

static INSTALL_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

fn is_shared_library(name: &str) -> bool {
    name.ends_with(".dll")
        || name.ends_with(".dylib")
        || name.ends_with(".jnilib")
        || name.contains(".so")
}

pub struct NativeArtifact {
    pub group_id: &'static str,
    pub artifact_id: &'static str,
    pub version: &'static str,
    pub sha256: &'static [(&'static str, &'static str)],
}

pub struct NativeBundle {
    pub id: &'static str,
    pub repository: &'static str,
    pub notice: &'static str,
    pub artifacts: &'static [NativeArtifact],
}

pub const FFMPEG: NativeBundle = NativeBundle {
    id: "nrc-ffmpeg",
    repository: "https://repo1.maven.org/maven2",
    notice: "FFmpeg is licensed under the GNU Lesser General Public License v2.1 or later.\n\
License: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html\n\
Source: https://ffmpeg.org/download.html\n\
\n\
JavaCPP and the JavaCPP Presets for FFmpeg are licensed under the Apache License 2.0.\n\
License: https://www.apache.org/licenses/LICENSE-2.0\n\
Source: https://github.com/bytedeco/javacpp and https://github.com/bytedeco/javacpp-presets\n\
\n\
The Microsoft Visual C++ runtime libraries are redistributed by the JavaCPP Presets\n\
under the Microsoft Visual C++ Redistributable license.",
    artifacts: &[
        NativeArtifact {
            group_id: "org.bytedeco",
            artifact_id: "javacpp",
            version: "1.5.14",
            sha256: &[
                ("windows-x86_64", "69bb4b0322aa807199485a9bf394ffe2117bb9ef5c34762b7d6567d7053087b5"),
                ("linux-x86_64", "1efab617735a44529bb85daaaefabe46c8686582989c46593c36569e9786fdaa"),
                ("linux-arm64", "30f63f17bb05cba4bdf488b77a3d9785b2ec261d4d528cf219b6c7081d20d636"),
                ("macosx-x86_64", "ce2e642c0317d08f08fc97ba44b2c18d2a22a85516fdec6b9854f3a930c5127b"),
                ("macosx-arm64", "75d755656d3ddafaa51c5d2d8d340c731a0bf2d742b033a37641a905aa2a7332"),
            ],
        },
        NativeArtifact {
            group_id: "org.bytedeco",
            artifact_id: "ffmpeg",
            version: "8.1.2-1.5.14",
            sha256: &[
                ("windows-x86_64", "67ebc3e6940add83b1b8a9dfd337a5c67556f2b72cb3225efe91a26874445c8e"),
                ("linux-x86_64", "6d0f000c4ddede3b669aa7c5c585e9b71f69b7f621fed7ab28ec01045dc336d0"),
                ("linux-arm64", "c8729978c862b0e2e5643ade1b41266c5ba8c34b791f41104e5794ad3cefd0bf"),
                ("macosx-x86_64", "b5a8f5124fb2d04412bd01eb5ca469d153d1c396fd0c67a33d3f9a1501c94c0c"),
                ("macosx-arm64", "af57468c0bb7b2e9c8c93547e6d599e2b4faa4117118555be92675850972420c"),
            ],
        },
    ],
};

pub struct NoriskNativesDownloadService;

impl NoriskNativesDownloadService {
    fn platform_key() -> Option<&'static str> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("windows", "x86_64") => Some("windows-x86_64"),
            ("macos", "x86_64") => Some("macosx-x86_64"),
            ("macos", "aarch64") => Some("macosx-arm64"),
            ("linux", "x86_64") => Some("linux-x86_64"),
            ("linux", "aarch64") => Some("linux-arm64"),
            _ => None,
        }
    }

    fn bundle_root(bundle: &NativeBundle) -> PathBuf {
        LAUNCHER_DIRECTORY.meta_dir().join(NATIVES_DIR).join(bundle.id)
    }

    fn install_dir(bundle: &NativeBundle, platform: &str) -> PathBuf {
        let digest = format!("{:x}", Sha256::digest(Self::fingerprint(bundle, platform).as_bytes()));
        Self::bundle_root(bundle).join(&digest[..DIR_NAME_LEN])
    }

    pub fn ffmpeg_dir() -> Option<PathBuf> {
        Some(Self::install_dir(&FFMPEG, Self::platform_key()?))
    }

    fn is_complete(dir: &Path) -> bool {
        let Ok(marker) = std::fs::read_to_string(dir.join(COMPLETE_MARKER)) else {
            return false;
        };
        let files: Vec<&str> = marker.lines().collect();
        !files.is_empty() && files.iter().all(|name| dir.join(name).is_file())
    }

    pub fn install_in_background(bundle: &'static NativeBundle) {
        tokio::spawn(async move {
            if let Err(e) = Self::install(bundle).await {
                warn!("[NRC Natives] Could not install '{}': {}", bundle.id, e);
            }
        });
    }

    async fn install(bundle: &NativeBundle) -> Result<()> {
        let Some(platform) = Self::platform_key() else {
            debug!("[NRC Natives] No '{}' build for this platform", bundle.id);
            return Ok(());
        };
        let _guard = INSTALL_LOCK.lock().await;

        let target = Self::install_dir(bundle, platform);
        if !Self::is_complete(&target) {
            Self::extract_bundle(bundle, platform, &target).await?;
        }
        Self::remove_other_versions(bundle, &target).await;
        Ok(())
    }

    async fn extract_bundle(bundle: &NativeBundle, platform: &str, target: &Path) -> Result<()> {
        info!("[NRC Natives] Installing '{}' for {} into {:?}", bundle.id, platform, target);
        let staging = target.with_extension("part");
        let _ = fs::remove_dir_all(&staging).await;
        fs::create_dir_all(&staging).await?;

        let mut extracted: Vec<String> = Vec::new();
        for artifact in bundle.artifacts {
            let jar = Self::download_artifact(bundle.repository, artifact, platform).await?;
            extracted.append(&mut Self::extract_platform_libraries(&jar, platform, &staging).await?);
        }
        if extracted.is_empty() {
            return Err(AppError::Download(format!("no native libraries found for {}", platform)));
        }
        fs::write(staging.join(NOTICE_FILE), Self::notice(bundle, platform)).await?;
        fs::write(staging.join(COMPLETE_MARKER), extracted.join("\n")).await?;

        let _ = fs::remove_dir_all(target).await;
        fs::rename(&staging, target).await?;
        info!("[NRC Natives] '{}' ready: {} files", bundle.id, extracted.len());
        Ok(())
    }

    async fn remove_other_versions(bundle: &NativeBundle, keep: &Path) {
        let Ok(mut entries) = fs::read_dir(Self::bundle_root(bundle)).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path == keep {
                continue;
            }
            if let Err(e) = fs::remove_dir_all(&path).await {
                debug!("[NRC Natives] Could not remove {} yet: {}", path.display(), e);
            }
        }
    }

    fn notice(bundle: &NativeBundle, platform: &str) -> String {
        let installed: Vec<String> = bundle
            .artifacts
            .iter()
            .map(|a| format!("  {}:{}:{}:{}", a.group_id, a.artifact_id, a.version, platform))
            .collect();
        format!("{}\n\nInstalled from {}:\n{}\n", bundle.notice, bundle.repository, installed.join("\n"))
    }

    fn fingerprint(bundle: &NativeBundle, platform: &str) -> String {
        let mut coords: Vec<String> = bundle
            .artifacts
            .iter()
            .map(|a| format!("{}:{}:{}:{}", a.group_id, a.artifact_id, a.version, platform))
            .collect();
        coords.sort();
        format!("v{} {}", EXTRACT_REVISION, coords.join(","))
    }

    async fn download_artifact(repository: &str, artifact: &NativeArtifact, classifier: &str) -> Result<PathBuf> {
        let sha256 = artifact
            .sha256
            .iter()
            .find(|(platform, _)| *platform == classifier)
            .map(|(_, sha256)| *sha256)
            .ok_or_else(|| {
                AppError::Download(format!("no pinned checksum for {} on {}", artifact.artifact_id, classifier))
            })?;
        let group_path = artifact.group_id.replace('.', "/");
        let filename = format!("{}-{}-{}.jar", artifact.artifact_id, artifact.version, classifier);
        let relative = format!("{}/{}/{}/{}", group_path, artifact.artifact_id, artifact.version, filename);
        let url = format!("{}/{}", repository.trim_end_matches('/'), relative);
        let target_path = LAUNCHER_DIRECTORY.meta_dir().join("libraries").join(&relative);

        let config = DownloadConfig::new().with_streaming(true).with_retries(3).with_sha256(sha256);
        DownloadUtils::download_file(&url, &target_path, config).await?;
        Ok(target_path)
    }

    async fn extract_platform_libraries(jar: &Path, classifier: &str, target_dir: &Path) -> Result<Vec<String>> {
        let jar = jar.to_path_buf();
        let target_dir = target_dir.to_path_buf();
        let marker = format!("/{}/", classifier);

        tokio::task::spawn_blocking(move || -> Result<Vec<String>> {
            let file = std::fs::File::open(&jar)?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| AppError::Download(e.to_string()))?;
            let mut written = Vec::new();

            for index in 0..archive.len() {
                let mut entry = archive.by_index(index).map_err(|e| AppError::Download(e.to_string()))?;
                let name = entry.name().to_string();
                if entry.is_dir() || !name.contains(&marker) || name.starts_with("META-INF/") {
                    continue;
                }
                if !is_shared_library(&name) {
                    continue;
                }
                let Some(file_name) = entry
                    .enclosed_name()
                    .and_then(|path| path.file_name().map(|n| n.to_string_lossy().into_owned()))
                else {
                    continue;
                };
                let mut out = std::fs::File::create(target_dir.join(&file_name))?;
                std::io::copy(&mut entry, &mut out)?;
                written.push(file_name);
            }
            Ok(written)
        })
        .await
        .map_err(|e| AppError::Other(format!("native extraction task failed: {}", e)))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUPPORTED: [&str; 5] = ["windows-x86_64", "linux-x86_64", "linux-arm64", "macosx-x86_64", "macosx-arm64"];

    #[test]
    fn every_supported_platform_downloads_against_a_pinned_checksum() {
        for artifact in FFMPEG.artifacts {
            for platform in SUPPORTED {
                let pinned = artifact.sha256.iter().find(|(p, _)| *p == platform).map(|(_, sha)| *sha);
                let sha = pinned.unwrap_or_else(|| panic!("{} has no checksum for {}", artifact.artifact_id, platform));
                assert!(sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()));
            }
        }
    }

    #[test]
    fn this_machine_resolves_to_a_supported_platform_or_none() {
        if let Some(platform) = NoriskNativesDownloadService::platform_key() {
            assert!(SUPPORTED.contains(&platform));
        }
    }

    #[test]
    fn a_version_bump_installs_into_a_new_folder() {
        const BUMPED: NativeBundle = NativeBundle {
            id: "nrc-ffmpeg",
            repository: "https://repo1.maven.org/maven2",
            notice: "",
            artifacts: &[NativeArtifact { group_id: "org.bytedeco", artifact_id: "ffmpeg", version: "9.0-1.5.15", sha256: &[] }],
        };
        let current = NoriskNativesDownloadService::install_dir(&FFMPEG, "windows-x86_64");
        let bumped = NoriskNativesDownloadService::install_dir(&BUMPED, "windows-x86_64");
        assert_ne!(current, bumped);
        assert_eq!(current.parent(), bumped.parent());
    }
}
