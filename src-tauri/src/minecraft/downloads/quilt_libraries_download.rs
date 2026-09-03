use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::quilt_meta::{QuiltLibrary, QuiltVersionInfo};
use crate::utils::download_utils::{DownloadUtils, DownloadConfig};
use futures::stream::StreamExt;
use log::{info, trace};
use std::path::PathBuf;
use tokio::fs;

pub struct QuiltLibrariesDownloadService {
    base_path: PathBuf,
    libraries_path: PathBuf,
    concurrent_downloads: usize,
}

impl QuiltLibrariesDownloadService {
    pub fn new() -> Self {
        Self {
            base_path: LAUNCHER_DIRECTORY.meta_dir().join("quilt"),
            libraries_path: LAUNCHER_DIRECTORY.meta_dir().join("libraries"),
            concurrent_downloads: 10,
        }
    }

    pub fn set_concurrent_downloads(&mut self, count: usize) {
        self.concurrent_downloads = count;
    }

    pub fn print_version_info(&self, version: &QuiltVersionInfo) {
        trace!("=== Quilt Version ===");
        trace!("Loader:");
        trace!("  - Version: {}", version.loader.version);
        trace!("  - Build: {}", version.loader.build);
        trace!("  - Maven: {}", version.loader.maven);
        trace!("  - Stable: {}", version.loader.stable);
        trace!("  - Separator: {}", version.loader.separator);

        trace!("Intermediary:");
        trace!("  - Version: {}", version.intermediary.version);
        trace!("  - Maven: {}", version.intermediary.maven);
        trace!("  - Stable: {}", version.intermediary.stable);

        trace!("Launcher Meta:");
        trace!("  - Version: {}", version.launcher_meta.version);
        if let Some(min_java) = version.launcher_meta.min_java_version {
            trace!("  - Min Java Version: {}", min_java);
        }
        trace!(
            "  - Main Class (Client): {}",
            version.launcher_meta.main_class.get_client()
        );
        trace!(
            "  - Main Class (Server): {}",
            version.launcher_meta.main_class.get_server()
        );

        trace!("Libraries:");
        self.print_libraries(&version.launcher_meta.libraries.common, "Common Libraries");
        self.print_libraries(&version.launcher_meta.libraries.client, "Client Libraries");
        self.print_libraries(&version.launcher_meta.libraries.server, "Server Libraries");
        if let Some(dev_libs) = &version.launcher_meta.libraries.development {
            self.print_libraries(dev_libs, "Development Libraries");
        }
    }

    fn print_libraries(&self, libraries: &[QuiltLibrary], title: &str) {
        trace!("  {}:", title);
        for lib in libraries {
            trace!("    - Name: {}", lib.name);
            if let Some(url) = &lib.url {
                trace!("      URL: {}", url);
            }
            if let Some(size) = lib.size {
                trace!("      Size: {} bytes", size);
            }
            if let Some(sha1) = &lib.sha1 {
                trace!("      SHA1: {}", sha1);
            }
            trace!("");
        }
    }

    fn create_library_from_maven(&self, maven: &str) -> QuiltLibrary {
        QuiltLibrary {
            name: maven.to_string(),
            url: Some("https://maven.quiltmc.org/repository/release/".to_string()),
            md5: None,
            sha1: None,
            sha256: None,
            sha512: None,
            size: None,
        }
    }

    fn create_library_from_fabric_maven(&self, maven: &str) -> QuiltLibrary {
        QuiltLibrary {
            name: maven.to_string(),
            url: Some("https://maven.fabricmc.net/".to_string()),
            md5: None,
            sha1: None,
            sha256: None,
            sha512: None,
            size: None,
        }
    }

    pub async fn download_quilt_libraries(&self, version: &QuiltVersionInfo) -> Result<()> {
        info!("Downloading Quilt components...");

        let mut all_libraries = Vec::new();
        all_libraries.push(self.create_library_from_maven(&version.loader.maven));
        
        // Use Fabric Maven for net.fabricmc:intermediary, otherwise use Quilt Maven
        if version.intermediary.maven.starts_with("net.fabricmc:") {
            all_libraries.push(self.create_library_from_fabric_maven(&version.intermediary.maven));
        } else {
            all_libraries.push(self.create_library_from_maven(&version.intermediary.maven));
        }
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.common);
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.client);
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.server);
        if let Some(dev_libs) = &version.launcher_meta.libraries.development {
            all_libraries.extend_from_slice(dev_libs);
        }

        info!("Found {} components to download", all_libraries.len());
        trace!("Downloading with {} concurrent downloads", self.concurrent_downloads);

        let downloads = futures::stream::iter(all_libraries.into_iter())
            .map(|library| {
                let self_clone = self.clone();
                async move {
                    let result = self_clone.download_library(&library).await;
                    match &result {
                        Ok(_) => trace!("✅ Successfully downloaded: {}", library.name),
                        Err(e) => info!("❌ Failed to download {}: {}", library.name, e),
                    }
                    result
                }
            })
            .buffer_unordered(self.concurrent_downloads);

        let results: Vec<Result<()>> = downloads.collect().await;
        let errors: Vec<_> = results.into_iter().filter_map(|r| r.err()).collect();

        if !errors.is_empty() {
            info!("⚠️ Some downloads failed:");
            for error in errors {
                info!("  - {}", error);
            }
            return Err(crate::error::AppError::QuiltError(
                "Some components failed to download".to_string(),
            ));
        }

        info!("✅ All Quilt components downloaded successfully!");
        Ok(())
    }

    async fn download_library(&self, library: &QuiltLibrary) -> Result<()> {
        let parts: Vec<&str> = library.name.split(':').collect();
        if parts.len() < 3 {
            return Ok(());
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");
        let base_url = library.url.as_deref().unwrap_or("https://repo1.maven.org/maven2/");
        let url = format!(
            "{}{}/{}/{}/{}-{}.jar",
            base_url, group_path, artifact, version, artifact, version
        );

        let target_path = self
            .libraries_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}.jar", artifact, version));

        if fs::try_exists(&target_path).await? && library.sha1.is_none() {
            trace!("📦 Library already exists: {}", library.name);
            return Ok(());
        }

        trace!("⬇️ Downloading: {} from {}", library.name, url);
        
        let config = if let Some(sha1) = &library.sha1 {
            DownloadConfig::new().with_sha1(sha1.clone())
        } else {
            DownloadConfig::default()
        };

        DownloadUtils::download_file(&url, &target_path, config).await
            .map_err(|e| crate::error::AppError::QuiltError(format!("Failed to download library: {}", e)))?;

        trace!("💾 Saved: {}", library.name);
        Ok(())
    }

    pub async fn get_library_paths(&self, version: &QuiltVersionInfo) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();

        self.add_maven_library_path(&version.loader.maven, &mut paths)?;
        self.add_maven_library_path(&version.intermediary.maven, &mut paths)?;

        for lib in &version.launcher_meta.libraries.common {
            self.add_library_path(lib, &mut paths)?;
        }

        for lib in &version.launcher_meta.libraries.client {
            self.add_library_path(lib, &mut paths)?;
        }

        Ok(paths)
    }

    fn add_maven_library_path(&self, maven: &str, paths: &mut Vec<PathBuf>) -> Result<()> {
        let parts: Vec<&str> = maven.split(':').collect();
        if parts.len() != 3 {
            return Err(crate::error::AppError::QuiltError(
                "Invalid Maven coordinates".to_string(),
            ));
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");
        let path = self
            .libraries_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}.jar", artifact, version));

        if path.exists() {
            paths.push(path);
            Ok(())
        } else {
            Err(crate::error::AppError::LibraryNotFound(format!(
                "Quilt library not found: {}",
                path.display()
            )))
        }
    }

    fn add_library_path(&self, library: &QuiltLibrary, paths: &mut Vec<PathBuf>) -> Result<()> {
        let parts: Vec<&str> = library.name.split(':').collect();
        if parts.len() != 3 {
            return Err(crate::error::AppError::QuiltError(
                "Invalid library name".to_string(),
            ));
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");
        let path = self
            .libraries_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}.jar", artifact, version));

        if path.exists() {
            paths.push(path);
            Ok(())
        } else {
            Err(crate::error::AppError::LibraryNotFound(format!(
                "Quilt library not found: {}",
                path.display()
            )))
        }
    }
}

impl Clone for QuiltLibrariesDownloadService {
    fn clone(&self) -> Self {
        Self {
            base_path: self.base_path.clone(),
            libraries_path: self.libraries_path.clone(),
            concurrent_downloads: self.concurrent_downloads,
        }
    }
}
