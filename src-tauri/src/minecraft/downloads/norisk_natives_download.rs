use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::{debug, info};
use std::path::{Path, PathBuf};
use tokio::fs;

const NATIVES_DIR: &str = "natives";
const MARKER_FILE: &str = ".nrc_natives";
const LIBRARY_EXTENSIONS: [&str; 4] = [".dll", ".so", ".dylib", ".jnilib"];

/// One Maven artifact whose platform-classified jar carries native libraries.
pub struct NativeArtifact {
    pub group_id: &'static str,
    pub artifact_id: &'static str,
    pub version: &'static str,
}

/// A bundle of native artifacts installed together into one launcher-global folder.
pub struct NativeBundle {
    pub id: &'static str,
    pub repository: &'static str,
    pub artifacts: &'static [NativeArtifact],
}

/// JavaCPP presets for ffmpeg, used by the client's Twitch stream player.
/// The client ships the Java bindings; only the platform natives come from here.
pub const FFMPEG: NativeBundle = NativeBundle {
    id: "nrc-ffmpeg",
    repository: "https://repo1.maven.org/maven2",
    artifacts: &[
        NativeArtifact { group_id: "org.bytedeco", artifact_id: "javacpp", version: "1.5.11" },
        NativeArtifact { group_id: "org.bytedeco", artifact_id: "ffmpeg", version: "7.1-1.5.11" },
    ],
};

/// Downloads a native bundle for the current platform and extracts its libraries into
/// `<meta_dir>/natives/<bundle id>/<platform>/`, shared by every profile on this machine.
pub struct NoriskNativesDownloadService;

impl NoriskNativesDownloadService {
    pub fn new() -> Self {
        Self
    }

    /// Platform key in the JavaCPP/Bytedeco classifier scheme, e.g. `windows-x86_64`.
    pub fn platform_key() -> String {
        let os = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macosx"
        } else {
            "linux"
        };
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
        format!("{}-{}", os, arch)
    }

    pub fn bundle_dir(bundle: &NativeBundle) -> PathBuf {
        LAUNCHER_DIRECTORY
            .meta_dir()
            .join(NATIVES_DIR)
            .join(bundle.id)
            .join(Self::platform_key())
    }

    pub fn ffmpeg_dir() -> PathBuf {
        Self::bundle_dir(&FFMPEG)
    }

    /// True once a previous install finished writing its marker; cheap enough for the launch path.
    pub fn ffmpeg_ready() -> bool {
        Self::ffmpeg_dir().join(MARKER_FILE).is_file()
    }

    pub async fn install(&self, bundle: &NativeBundle) -> Result<PathBuf> {
        let platform = Self::platform_key();
        let target_dir = Self::bundle_dir(bundle);
        let marker_path = target_dir.join(MARKER_FILE);
        let fingerprint = Self::fingerprint(bundle, &platform);

        if Self::is_up_to_date(&marker_path, &target_dir, &fingerprint).await {
            debug!("[NRC Natives] '{}' up to date for {}", bundle.id, platform);
            return Ok(target_dir);
        }

        info!("[NRC Natives] Installing '{}' for {} into {:?}", bundle.id, platform, target_dir);
        fs::create_dir_all(&target_dir).await?;

        let mut extracted: Vec<String> = Vec::new();
        for artifact in bundle.artifacts {
            let jar = self.download_artifact(bundle.repository, artifact, &platform).await?;
            let mut files = Self::extract_platform_libraries(&jar, &platform, &target_dir).await?;
            extracted.append(&mut files);
        }
        if extracted.is_empty() {
            return Err(AppError::Download(format!("no native libraries found for {}", platform)));
        }

        let mut marker = fingerprint;
        for name in &extracted {
            marker.push('\n');
            marker.push_str(name);
        }
        fs::write(&marker_path, marker).await?;
        info!("[NRC Natives] '{}' ready: {} files", bundle.id, extracted.len());
        Ok(target_dir)
    }

    fn fingerprint(bundle: &NativeBundle, platform: &str) -> String {
        let mut coords: Vec<String> = bundle
            .artifacts
            .iter()
            .map(|a| format!("{}:{}:{}:{}", a.group_id, a.artifact_id, a.version, platform))
            .collect();
        coords.sort();
        coords.join(",")
    }

    async fn is_up_to_date(marker_path: &Path, target_dir: &Path, fingerprint: &str) -> bool {
        let content = match fs::read_to_string(marker_path).await {
            Ok(content) => content,
            Err(_) => return false,
        };
        let mut lines = content.lines();
        if lines.next() != Some(fingerprint) {
            return false;
        }
        let mut any = false;
        for name in lines {
            any = true;
            if !fs::try_exists(target_dir.join(name)).await.unwrap_or(false) {
                return false;
            }
        }
        any
    }

    async fn download_artifact(&self, repository: &str, artifact: &NativeArtifact, classifier: &str) -> Result<PathBuf> {
        let group_path = artifact.group_id.replace('.', "/");
        let filename = format!("{}-{}-{}.jar", artifact.artifact_id, artifact.version, classifier);
        let relative = format!("{}/{}/{}/{}", group_path, artifact.artifact_id, artifact.version, filename);
        let url = format!("{}/{}", repository.trim_end_matches('/'), relative);
        let target_path = LAUNCHER_DIRECTORY.meta_dir().join("libraries").join(&relative);

        let mut config = DownloadConfig::new().with_streaming(true).with_retries(3);
        if let Some(sha1) = DownloadUtils::try_fetch_sha1_sidecar(&url).await {
            config = config.with_sha1(sha1);
        }
        DownloadUtils::download_file(&url, &target_path, config).await?;
        Ok(target_path)
    }

    /// Extracts every library file that lives under a `<classifier>/` directory inside the
    /// jar, flattened into `target_dir`.
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
                if !LIBRARY_EXTENSIONS.iter().any(|ext| name.ends_with(ext)) {
                    continue;
                }
                let file_name = match name.rsplit('/').next() {
                    Some(base) if !base.is_empty() => base.to_string(),
                    _ => continue,
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
