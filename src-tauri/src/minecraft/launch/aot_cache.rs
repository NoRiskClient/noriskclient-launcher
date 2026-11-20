use log::{info, warn};
use sha1::{Digest, Sha1};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use uuid::Uuid;

pub const AOT_CACHE_MIN_JAVA: u32 = 25;
const MAX_CACHES: usize = 3;
const ARCHIVE_FLAGS: [&str; 4] = [
    "-XX:AOT",
    "-XX:SharedArchiveFile",
    "-XX:ArchiveClassesAtExit",
    "-Xshare",
];
/// A recording this old was left behind by a launcher closed while the game ran.
const ORPHAN_AGE: Duration = Duration::from_secs(60 * 60);

/// Only Fabric can keep the client jar off the classpath (via `fabric.gameJarPath`), and
/// recording with the jar on it stalls JVM startup for minutes.
pub fn aot_cache_applies<'a>(
    java_major: u32,
    is_fabric: bool,
    jvm_args: impl IntoIterator<Item = &'a str>,
) -> bool {
    java_major >= AOT_CACHE_MIN_JAVA
        && is_fabric
        && !jvm_args
            .into_iter()
            .any(|arg| ARCHIVE_FLAGS.iter().any(|flag| arg.starts_with(flag)))
}

/// The JVM only uses a cache with the module flags it was built with.
pub fn module_flags<'a>(jvm_args: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut args = jvm_args.into_iter().peekable();
    let mut flags = Vec::new();
    while let Some(arg) = args.next() {
        if arg.starts_with("--") {
            flags.push(arg.to_string());
            if !arg.contains('=') {
                flags.extend(
                    args.next_if(|value| !value.starts_with('-'))
                        .map(String::from),
                );
            }
        }
    }
    flags
}

pub struct AotRecording {
    java_path: PathBuf,
    module_flags: Vec<String>,
    classpath: String,
    configuration: PathBuf,
    cache: PathBuf,
}

/// Returns the JVM args that start from the cache, or record it if there is none yet.
pub fn prepare_aot_cache(
    dir: &Path,
    java_path: &Path,
    module_flags: Vec<String>,
    classpath: &str,
) -> (Vec<String>, Option<AotRecording>) {
    let key = cache_key(java_path, &module_flags, classpath);
    let cache = dir.join(format!("{key}.aot"));
    if cache.exists() {
        if let Err(e) = fs::File::options()
            .write(true)
            .open(&cache)
            .and_then(|file| file.set_modified(SystemTime::now()))
        {
            warn!(
                "Could not mark AOT cache {} as used: {}",
                cache.display(),
                e
            );
        }
        prune_aot_caches(dir);
        info!("Using AOT cache {}", cache.display());
        return (vec![format!("-XX:AOTCache={}", cache.display())], None);
    }

    if let Err(e) = fs::create_dir_all(dir) {
        warn!(
            "Could not create AOT cache directory {}: {}",
            dir.display(),
            e
        );
        return (Vec::new(), None);
    }
    prune_aot_caches(dir);
    // Unique per launch, so two recording games never share a file.
    let configuration = dir.join(format!("{key}-{}.aotconf", Uuid::new_v4().simple()));
    info!("Recording AOT configuration {}", configuration.display());
    let args = vec![
        "-XX:AOTMode=record".to_string(),
        format!("-XX:AOTConfiguration={}", configuration.display()),
    ];
    let recording = AotRecording {
        java_path: java_path.to_path_buf(),
        module_flags,
        classpath: classpath.to_string(),
        configuration,
        cache,
    };
    (args, Some(recording))
}

impl AotRecording {
    /// Failures only cost the speedup, so they are only logged.
    pub async fn finish(self, clean_exit: bool) {
        if clean_exit && self.configuration.exists() {
            match self.create().await {
                Ok(()) => info!("Created AOT cache {}", self.cache.display()),
                Err(e) => warn!("Could not create AOT cache {}: {}", self.cache.display(), e),
            }
        }
        if let Err(e) = tokio::fs::remove_file(&self.configuration).await {
            if e.kind() != io::ErrorKind::NotFound {
                warn!("Could not remove {}: {}", self.configuration.display(), e);
            }
        }
        if let Some(dir) = self.cache.parent() {
            prune_aot_caches(dir);
        }
    }

    async fn create(&self) -> io::Result<()> {
        let partial = self.configuration.with_extension("aot.tmp");
        let mut command = tokio::process::Command::new(&self.java_path);
        command
            .args(&self.module_flags)
            .arg("-XX:AOTMode=create")
            .arg(format!(
                "-XX:AOTConfiguration={}",
                self.configuration.display()
            ))
            .arg(format!("-XX:AOTCache={}", partial.display()))
            .arg("-cp")
            .arg(&self.classpath)
            .stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(BELOW_NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW);
        }
        let output = command.output().await?;
        let result = if output.status.success() {
            tokio::fs::rename(&partial, &self.cache).await
        } else {
            Err(io::Error::other(format!(
                "{}: {}{}",
                output.status,
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        };
        if result.is_err() {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        result
    }
}

fn cache_key(java_path: &Path, module_flags: &[String], classpath: &str) -> String {
    // The runtime's `release` file names its exact build, so an updated JDK records anew.
    let release = fs::canonicalize(java_path)
        .ok()
        .and_then(|java| Some(java.parent()?.parent()?.join("release")))
        .and_then(|release| fs::read(release).ok())
        .unwrap_or_default();
    let mut hasher = Sha1::new();
    for part in [
        java_path.as_os_str().as_encoded_bytes(),
        &release,
        classpath.as_bytes(),
    ]
    .into_iter()
    .chain(module_flags.iter().map(|flag| flag.as_bytes()))
    {
        hasher.update(part);
        hasher.update([0]);
    }
    hasher.finalize()[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Keeps the [`MAX_CACHES`] most recently used caches (~185 MB each) and drops leftovers.
fn prune_aot_caches(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut caches = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else {
            continue;
        };
        if path.extension().is_some_and(|ext| ext == "aot") {
            caches.push((modified, path));
        } else if modified.elapsed().unwrap_or_default() > ORPHAN_AGE {
            remove(&path);
        }
    }
    caches.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in caches.iter().skip(MAX_CACHES) {
        remove(path);
    }
}

fn remove(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => info!("Removed AOT cache file {}", path.display()),
        Err(e) => warn!("Could not remove AOT cache file {}: {}", path.display(), e),
    }
}
