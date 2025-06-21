use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::fabric_meta::{FabricLibrary, FabricVersionInfo};
use futures::stream::StreamExt;
use log::info;
use reqwest;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

pub struct FabricLibrariesDownloadService {
    base_path: PathBuf,
    libraries_path: PathBuf,
    concurrent_downloads: usize,
}

impl FabricLibrariesDownloadService {
    pub fn new() -> Self {
        Self {
            base_path: LAUNCHER_DIRECTORY.meta_dir().join("fabric"),
            libraries_path: LAUNCHER_DIRECTORY.meta_dir().join("libraries"),
            concurrent_downloads: 10, // Default value
        }
    }

    pub fn set_concurrent_downloads(&mut self, count: usize) {
        self.concurrent_downloads = count;
    }

    pub fn print_version_info(&self, version: &FabricVersionInfo) {
        info!("\n=== Fabric Version ===");
        info!("Loader:");
        info!("  - Version: {}", version.loader.version);
        info!("  - Build: {}", version.loader.build);
        info!("  - Maven: {}", version.loader.maven);
        info!("  - Stable: {}", version.loader.stable);
        info!("  - Separator: {}", version.loader.separator);

        info!("\nIntermediary:");
        info!("  - Version: {}", version.intermediary.version);
        info!("  - Maven: {}", version.intermediary.maven);
        info!("  - Stable: {}", version.intermediary.stable);

        info!("\nLauncher Meta:");
        info!("  - Version: {}", version.launcher_meta.version);
        if let Some(min_java) = version.launcher_meta.min_java_version {
            info!("  - Min Java Version: {}", min_java);
        }
        info!(
            "  - Main Class (Client): {}",
            version.launcher_meta.main_class.get_client()
        );
        info!(
            "  - Main Class (Server): {}",
            version.launcher_meta.main_class.get_server()
        );

        info!("\nLibraries:");
        self.print_libraries(&version.launcher_meta.libraries.common, "Common Libraries");
        self.print_libraries(&version.launcher_meta.libraries.client, "Client Libraries");
        self.print_libraries(&version.launcher_meta.libraries.server, "Server Libraries");
        if let Some(dev_libs) = &version.launcher_meta.libraries.development {
            self.print_libraries(dev_libs, "Development Libraries");
        }
    }

    fn print_libraries(&self, libraries: &[FabricLibrary], title: &str) {
        info!("  {}:", title);
        for lib in libraries {
            info!("    - Name: {}", lib.name);
            if let Some(url) = &lib.url {
                info!("      URL: {}", url);
            }
            if let Some(size) = lib.size {
                info!("      Size: {} bytes", size);
            }
            if let Some(sha1) = &lib.sha1 {
                info!("      SHA1: {}", sha1);
            }
            info!("");
        }
    }

    async fn download_maven_artifact(&self, maven: &str) -> Result<()> {
        // Parse Maven coordinates (format: group:artifact:version)
        let parts: Vec<&str> = maven.split(':').collect();
        if parts.len() != 3 {
            return Err(crate::error::AppError::FabricError(
                "Invalid Maven coordinates".to_string(),
            ));
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");

        // Construct target path
        let target_path = self
            .libraries_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}.jar", artifact, version));

        // Check if file already exists
        if fs::try_exists(&target_path).await? {
            info!("📦 Maven artifact already exists: {}", maven);
            return Ok(());
        }

        // Construct Maven URL
        let url = format!(
            "https://maven.fabricmc.net/{}/{}/{}/{}-{}.jar",
            group_path, artifact, version, artifact, version
        );

        // Download the artifact
        info!("⬇️ Downloading Maven artifact: {}", maven);
        let response = reqwest::get(&url).await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to download Maven artifact: {}", e))
        })?;

        if !response.status().is_success() {
            return Err(crate::error::AppError::FabricError(format!(
                "Failed to download Maven artifact: Status {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to download Maven artifact: {}", e))
        })?;

        // Create parent directories if they don't exist
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Save the file
        let mut file = fs::File::create(&target_path).await?;
        file.write_all(&bytes).await?;
        
        // Ensure the file is fully written to disk before attempting to read it.
        // This prevents potential "end of central directory record not found" errors with jar files
        // that can occur if we try to read the file before the OS has flushed all write buffers.
        file.sync_all().await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to sync fabric maven artifact: {}", e))
        })?;
        // Explicitly close the file by dropping the handle
        drop(file);

        info!("💾 Saved Maven artifact: {}", maven);
        Ok(())
    }

    fn create_library_from_maven(&self, maven: &str) -> FabricLibrary {
        let parts: Vec<&str> = maven.split(':').collect();
        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");

        // Only set the base URL, the rest will be built in download_library
        let url = "https://maven.fabricmc.net/".to_string();

        FabricLibrary {
            name: maven.to_string(),
            url: Some(url),
            md5: None,
            sha1: None,
            sha256: None,
            sha512: None,
            size: None,
        }
    }

    pub async fn download_fabric_libraries(&self, version: &FabricVersionInfo) -> Result<()> {
        info!("\nDownloading Fabric components...");

        // Combine all libraries into a single vector
        let mut all_libraries = Vec::new();

        // Add loader and intermediary as libraries
        all_libraries.push(self.create_library_from_maven(&version.loader.maven));
        all_libraries.push(self.create_library_from_maven(&version.intermediary.maven));

        // Add all other libraries
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.common);
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.client);
        all_libraries.extend_from_slice(&version.launcher_meta.libraries.server);
        if let Some(dev_libs) = &version.launcher_meta.libraries.development {
            all_libraries.extend_from_slice(dev_libs);
        }

        info!("Found {} components to download", all_libraries.len());
        info!(
            "Downloading with {} concurrent downloads",
            self.concurrent_downloads
        );

        // Create a stream of download tasks
        let downloads = futures::stream::iter(all_libraries.into_iter())
            .map(|library| {
                let self_clone = self;
                async move {
                    let result = self_clone.download_library(&library).await;

                    match &result {
                        Ok(_) => {
                            // Only print success if we actually downloaded something
                            if !fs::try_exists(
                                self_clone
                                    .libraries_path
                                    .join(&library.name.replace(':', "/"))
                                    .join(format!(
                                        "{}-{}.jar",
                                        library.name.split(':').nth(1).unwrap(),
                                        library.name.split(':').nth(2).unwrap()
                                    )),
                            )
                            .await?
                            {
                                info!("✅ Successfully downloaded: {}", library.name);
                            }
                        }
                        Err(e) => info!("❌ Failed to download {}: {}", library.name, e),
                    }

                    result
                }
            })
            .buffer_unordered(self.concurrent_downloads);

        // Execute all downloads and collect results
        let results: Vec<Result<()>> = downloads.collect().await;

        // Check for any errors
        let errors: Vec<_> = results.into_iter().filter_map(|r| r.err()).collect();

        if !errors.is_empty() {
            info!("\n⚠️ Some downloads failed:");
            for error in errors {
                info!("  - {}", error);
            }
            return Err(crate::error::AppError::FabricError(
                "Some components failed to download".to_string(),
            ));
        }

        info!("\n✅ All Fabric components downloaded successfully!");
        Ok(())
    }

    async fn download_library(&self, library: &FabricLibrary) -> Result<()> {
        // Parse Maven coordinates from library name
        let parts: Vec<&str> = library.name.split(':').collect();
        if parts.len() < 3 {
            return Ok(());
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        let group_path = group.replace('.', "/");

        // Try Fabric Maven first, then Maven Central
        let base_url = match &library.url {
            Some(url) => url,
            None => "https://repo1.maven.org/maven2/",
        };

        // Build the complete URL
        let url = format!(
            "{}{}/{}/{}/{}-{}.jar",
            base_url, group_path, artifact, version, artifact, version
        );

        // Construct target path
        let target_path = self
            .libraries_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}.jar", artifact, version));

        // Check if file exists and verify hash if available
        if fs::try_exists(&target_path).await? {
            if let Some(expected_sha1) = &library.sha1 {
                let file_content = fs::read(&target_path).await?;
                let mut hasher = Sha1::new();
                hasher.update(&file_content);
                let actual_sha1 = format!("{:x}", hasher.finalize());

                if actual_sha1 == *expected_sha1 {
                    info!(
                        "📦 Library already exists and hash matches: {}",
                        library.name
                    );
                    return Ok(());
                } else {
                    info!(
                        "⚠️ Library exists but hash mismatch, redownloading: {}",
                        library.name
                    );
                }
            } else {
                info!("📦 Library already exists: {}", library.name);
                return Ok(());
            }
        }

        // Download the library
        info!("⬇️ Downloading: {} from {}", library.name, url);
        let response = reqwest::get(url).await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to download library: {}", e))
        })?;

        if !response.status().is_success() {
            return Err(crate::error::AppError::FabricError(format!(
                "Failed to download library: Status {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to download library: {}", e))
        })?;

        // Verify hash if available
        if let Some(expected_sha1) = &library.sha1 {
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            let actual_sha1 = format!("{:x}", hasher.finalize());

            if actual_sha1 != *expected_sha1 {
                return Err(crate::error::AppError::FabricError(format!(
                    "Hash mismatch for {}: expected {}, got {}",
                    library.name, expected_sha1, actual_sha1
                )));
            }
        }

        // Create parent directories if they don't exist
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Save the file
        let mut file = fs::File::create(&target_path).await?;
        file.write_all(&bytes).await?;
        
        // Ensure the file is fully written to disk before attempting to read it.
        // This prevents potential "end of central directory record not found" errors with jar files
        // that can occur if we try to read the file before the OS has flushed all write buffers.
        file.sync_all().await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to sync fabric library: {}", e))
        })?;
        // Explicitly close the file by dropping the handle
        drop(file);

        info!("💾 Saved: {}", library.name);
        Ok(())
    }

    pub async fn get_library_paths(&self, version: &FabricVersionInfo) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();

        // Add loader and intermediary libraries
        self.add_maven_library_path(&version.loader.maven, &mut paths)?;
        self.add_maven_library_path(&version.intermediary.maven, &mut paths)?;

        // Add common libraries
        for lib in &version.launcher_meta.libraries.common {
            self.add_library_path(lib, &mut paths)?;
        }

        // Add client libraries
        for lib in &version.launcher_meta.libraries.client {
            self.add_library_path(lib, &mut paths)?;
        }

        Ok(paths)
    }

    fn add_maven_library_path(&self, maven: &str, paths: &mut Vec<PathBuf>) -> Result<()> {
        let parts: Vec<&str> = maven.split(':').collect();
        if parts.len() != 3 {
            return Err(crate::error::AppError::FabricError(
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
                "Fabric library not found: {}",
                path.display()
            )))
        }
    }

    fn add_library_path(&self, library: &FabricLibrary, paths: &mut Vec<PathBuf>) -> Result<()> {
        let parts: Vec<&str> = library.name.split(':').collect();
        if parts.len() != 3 {
            return Err(crate::error::AppError::FabricError(
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
                "Fabric library not found: {}",
                path.display()
            )))
        }
    }
}
