use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::{debug, info};
use std::path::{Path, PathBuf};
use tokio::fs;

const NATIVES_DIR: &str = "natives";
const MARKER_FILE: &str = ".nrc_natives";
const EXTRACT_REVISION: u32 = 2;

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
    pub sha1: &'static [(&'static str, &'static str)],
}

pub struct NativeBundle {
    pub id: &'static str,
    pub repository: &'static str,
    pub artifacts: &'static [NativeArtifact],
}

pub const FFMPEG: NativeBundle = NativeBundle {
    id: "nrc-ffmpeg",
    repository: "https://repo1.maven.org/maven2",
    artifacts: &[
        NativeArtifact {
            group_id: "org.bytedeco",
            artifact_id: "javacpp",
            version: "1.5.14",
            sha1: &[
                ("windows-x86_64", "ae82695fc501e0cb0439eecd0053f9dbc672ab2f"),
                ("linux-x86_64", "c680537786a2dd853a5cc79a40232b527d88da4a"),
                ("linux-arm64", "76405f9e4f4ec5a19eefc6b2ac28784fb02d9801"),
                ("macosx-x86_64", "da447091fa8f6f43e09b3d122838d19d20e9e094"),
                ("macosx-arm64", "0eb5dd2b2e46451331aa9fdc2c8a35a9dd2af769"),
            ],
        },
        NativeArtifact {
            group_id: "org.bytedeco",
            artifact_id: "ffmpeg",
            version: "8.1.2-1.5.14",
            sha1: &[
                ("windows-x86_64", "d84fe6debb37938661264be921425c4b81136c0b"),
                ("linux-x86_64", "c0dde01ef96cf51ec71e33a1e1a285e23cef4ba0"),
                ("linux-arm64", "d8bbe76e9147ecbaba69e821ffdd2f2706b79e65"),
                ("macosx-x86_64", "b1c0050ee1baa56617e9707df2bda9a2eaf41db9"),
                ("macosx-arm64", "818279ea8f1523ed01136c3871609d90e96042ba"),
            ],
        },
    ],
};

pub struct NoriskNativesDownloadService;

impl NoriskNativesDownloadService {
    pub fn new() -> Self {
        Self
    }

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

    fn bundle_dir(bundle: &NativeBundle, platform: &str) -> PathBuf {
        LAUNCHER_DIRECTORY
            .meta_dir()
            .join(NATIVES_DIR)
            .join(bundle.id)
            .join(platform)
    }

    pub fn installed_ffmpeg_dir() -> Option<PathBuf> {
        Self::installed_dir(&FFMPEG)
    }

    fn installed_dir(bundle: &NativeBundle) -> Option<PathBuf> {
        let platform = Self::platform_key()?;
        let dir = Self::bundle_dir(bundle, platform);
        let marker = std::fs::read_to_string(dir.join(MARKER_FILE)).ok()?;
        let mut lines = marker.lines();
        if lines.next() != Some(Self::fingerprint(bundle, platform).as_str()) {
            return None;
        }
        let files: Vec<&str> = lines.collect();
        let complete = !files.is_empty() && files.iter().all(|name| dir.join(name).is_file());
        complete.then_some(dir)
    }

    pub async fn install(&self, bundle: &NativeBundle) -> Result<()> {
        let Some(platform) = Self::platform_key() else {
            debug!("[NRC Natives] No '{}' build for this platform", bundle.id);
            return Ok(());
        };
        if Self::installed_dir(bundle).is_some() {
            debug!("[NRC Natives] '{}' up to date for {}", bundle.id, platform);
            return Ok(());
        }

        let target_dir = Self::bundle_dir(bundle, platform);
        let marker_path = target_dir.join(MARKER_FILE);
        info!("[NRC Natives] Installing '{}' for {} into {:?}", bundle.id, platform, target_dir);
        fs::create_dir_all(&target_dir).await?;
        let _ = fs::remove_file(&marker_path).await;

        let mut extracted: Vec<String> = Vec::new();
        for artifact in bundle.artifacts {
            let jar = self.download_artifact(bundle.repository, artifact, platform).await?;
            extracted.append(&mut Self::extract_platform_libraries(&jar, platform, &target_dir).await?);
        }
        if extracted.is_empty() {
            return Err(AppError::Download(format!("no native libraries found for {}", platform)));
        }

        let mut marker = Self::fingerprint(bundle, platform);
        for name in &extracted {
            marker.push('\n');
            marker.push_str(name);
        }
        fs::write(&marker_path, marker).await?;
        info!("[NRC Natives] '{}' ready: {} files", bundle.id, extracted.len());
        Ok(())
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

    async fn download_artifact(&self, repository: &str, artifact: &NativeArtifact, classifier: &str) -> Result<PathBuf> {
        let sha1 = artifact
            .sha1
            .iter()
            .find(|(platform, _)| *platform == classifier)
            .map(|(_, sha1)| *sha1)
            .ok_or_else(|| {
                AppError::Download(format!("no pinned checksum for {} on {}", artifact.artifact_id, classifier))
            })?;
        let group_path = artifact.group_id.replace('.', "/");
        let filename = format!("{}-{}-{}.jar", artifact.artifact_id, artifact.version, classifier);
        let relative = format!("{}/{}/{}/{}", group_path, artifact.artifact_id, artifact.version, filename);
        let url = format!("{}/{}", repository.trim_end_matches('/'), relative);
        let target_path = LAUNCHER_DIRECTORY.meta_dir().join("libraries").join(&relative);

        let config = DownloadConfig::new().with_streaming(true).with_retries(3).with_sha1(sha1);
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
                let pinned = artifact.sha1.iter().find(|(p, _)| *p == platform).map(|(_, sha1)| *sha1);
                let sha1 = pinned.unwrap_or_else(|| panic!("{} has no checksum for {}", artifact.artifact_id, platform));
                assert!(sha1.len() == 40 && sha1.bytes().all(|b| b.is_ascii_hexdigit()));
            }
        }
    }

    #[test]
    fn this_machine_resolves_to_a_supported_platform_or_none() {
        if let Some(platform) = NoriskNativesDownloadService::platform_key() {
            assert!(SUPPORTED.contains(&platform));
        }
    }
}
