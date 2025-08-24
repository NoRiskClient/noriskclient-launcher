use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::system_info::{Architecture, OperatingSystem, OS};
use lazy_static::lazy_static;
use log::{info, warn};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Stdio;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

// Global cache of detected Java installations
lazy_static! {
    static ref JAVA_INSTALLATIONS: Arc<RwLock<Option<Vec<JavaInstallation>>>> =
        Arc::new(RwLock::new(None));
}

/// Represents a detected Java installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    /// Path to the Java executable
    pub path: PathBuf,
    /// Java version (e.g., "17.0.2")
    pub version: String,
    /// Major version (e.g., 17)
    pub major_version: u32,
    /// Whether this is a 64-bit Java installation
    pub is_64bit: bool,
    /// The Java vendor (Oracle, OpenJDK, etc.)
    pub vendor: String,
    /// The Java VM name (HotSpot, OpenJ9, etc.)
    pub vm_name: Option<String>,
    /// Installation source (system path, program files, etc.)
    pub source: String,
    /// Architecture of the Java installation
    pub architecture: Architecture,
}

impl JavaInstallation {
    /// Returns true if this Java installation is suitable for Minecraft
    pub fn is_suitable_for_minecraft(&self) -> bool {
        // Minecraft generally needs at least Java 8
        self.major_version >= 8
    }

    /// Checks if this Java installation is recommended for the given Minecraft version
    pub fn is_recommended_for_minecraft(&self, mc_version: &str) -> bool {
        let mc_version_parts: Vec<&str> = mc_version.split('.').collect();

        if mc_version_parts.is_empty() {
            return false;
        }

        // Parse major version
        let major = match mc_version_parts[0].parse::<u32>() {
            Ok(v) => v,
            Err(_) => return false,
        };

        match major {
            // Minecraft 1.16.5+ recommended Java 16
            1 if mc_version_parts.len() > 1 => {
                let minor = match mc_version_parts[1].parse::<u32>() {
                    Ok(v) => v,
                    Err(_) => return false,
                };

                match minor {
                    // Minecraft 1.0-1.16.4 uses Java 8
                    0..=16 => {
                        if minor == 16 {
                            // Check patch level for 1.16
                            if mc_version_parts.len() > 2 {
                                if let Ok(patch) = mc_version_parts[2].parse::<u32>() {
                                    if patch >= 5 {
                                        // 1.16.5+ recommended Java 16
                                        return self.major_version >= 16;
                                    }
                                }
                            }
                        }
                        // Minecraft 1.0-1.16.4 uses Java 8
                        self.major_version >= 8 && self.major_version <= 8
                    }
                    // Minecraft 1.17 uses Java 16+
                    17 => self.major_version >= 16,
                    // Minecraft 1.18+ uses Java 17+
                    18..=u32::MAX => self.major_version >= 17,
                    _ => false,
                }
            }
            _ => false,
        }
    }
}

/// Detects Java installations in the launcher's meta/java directory
async fn detect_java_in_launcher_dir() -> Result<Vec<JavaInstallation>> {
    info!("Detecting Java installations in launcher directory");
    let mut installations = Vec::new();

    // Get the launcher's meta/java directory
    let java_dir = crate::config::standard_meta_dir().join("java");
    info!("Checking for Java installations in: {}", java_dir.display());

    // Create the directory if it doesn't exist
    if !java_dir.exists() {
        info!("Creating launcher Java directory: {}", java_dir.display());
        fs::create_dir_all(&java_dir).await?;
        return Ok(installations); // Return empty, we just created the directory
    }

    // List all directories in the java_dir, each may contain a Java installation
    let mut read_dir = fs::read_dir(&java_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        info!(
            "Checking potential Java installation in: {}",
            path.display()
        );

        // Try to find java executable
        let java_exe = if cfg!(windows) {
            path.join("bin").join("java.exe")
        } else {
            path.join("bin").join("java")
        };

        if java_exe.exists() {
            match get_java_info(&java_exe).await {
                Ok(mut info) => {
                    let version_clone = info.version.clone(); // Clone version before move
                    info.source = "Launcher Directory".to_string();
                    installations.push(info);
                    info!(
                        "Found valid Java installation: {} ({})",
                        java_exe.display(),
                        version_clone
                    );
                }
                Err(e) => {
                    warn!("Invalid Java installation at {}: {}", java_exe.display(), e);
                }
            }
        } else {
            // Also check if the directory itself is a JRE without bin subdirectory
            let direct_java_exe = if cfg!(windows) {
                path.join("java.exe")
            } else {
                path.join("java")
            };

            if direct_java_exe.exists() {
                match get_java_info(&direct_java_exe).await {
                    Ok(mut info) => {
                        let version_clone = info.version.clone(); // Clone version before move
                        info.source = "Launcher Directory".to_string();
                        installations.push(info);
                        info!(
                            "Found valid Java executable: {} ({})",
                            direct_java_exe.display(),
                            version_clone
                        );
                    }
                    Err(e) => {
                        warn!(
                            "Invalid Java executable at {}: {}",
                            direct_java_exe.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    info!(
        "Found {} Java installations in launcher directory",
        installations.len()
    );
    Ok(installations)
}

/// Detects all Java installations on the system
pub async fn detect_java_installations() -> Result<Vec<JavaInstallation>> {
    // Check if we have cached results
    {
        let installations = JAVA_INSTALLATIONS.read().await;
        if let Some(ref cached) = *installations {
            info!("Using cached Java installations ({} found)", cached.len());
            return Ok(cached.clone());
        }
    }

    info!("Detecting Java installations...");
    let mut installations = Vec::new();

    // Check in launcher's meta/java directory first
    match detect_java_in_launcher_dir().await {
        Ok(launcher_javas) => {
            for installation in launcher_javas {
                info!(
                    "Found Java in launcher directory: {} ({})",
                    installation.path.display(),
                    installation.version
                );
                installations.push(installation);
            }
        }
        Err(e) => warn!("Failed to detect Java in launcher directory: {}", e),
    }

    // Look in PATH
    match detect_java_in_system_path().await {
        Ok(java_paths) => {
            for installation in java_paths {
                info!(
                    "Found Java in PATH: {} ({})",
                    installation.path.display(),
                    installation.version
                );
                installations.push(installation);
            }
        }
        Err(e) => warn!("Failed to detect Java in PATH: {}", e),
    }

    // OS-specific paths
    match OS {
        OperatingSystem::WINDOWS => {
            // Add Windows-specific detection
            match detect_java_on_windows().await {
                Ok(windows_javas) => {
                    for installation in windows_javas {
                        info!(
                            "Found Java on Windows: {} ({})",
                            installation.path.display(),
                            installation.version
                        );
                        installations.push(installation);
                    }
                }
                Err(e) => warn!("Failed to detect Java on Windows: {}", e),
            }
        }
        OperatingSystem::OSX => {
            // Add macOS-specific detection
            match detect_java_on_macos().await {
                Ok(macos_javas) => {
                    for installation in macos_javas {
                        info!(
                            "Found Java on macOS: {} ({})",
                            installation.path.display(),
                            installation.version
                        );
                        installations.push(installation);
                    }
                }
                Err(e) => warn!("Failed to detect Java on macOS: {}", e),
            }
        }
        OperatingSystem::LINUX => {
            // Add Linux-specific detection
            match detect_java_on_linux().await {
                Ok(linux_javas) => {
                    for installation in linux_javas {
                        info!(
                            "Found Java on Linux: {} ({})",
                            installation.path.display(),
                            installation.version
                        );
                        installations.push(installation);
                    }
                }
                Err(e) => warn!("Failed to detect Java on Linux: {}", e),
            }
        }
        _ => warn!("Unsupported OS for Java detection"),
    }

    // Remove duplicates based on path
    installations.sort_by(|a, b| {
        let path_cmp = a.path.to_string_lossy().cmp(&b.path.to_string_lossy());
        if path_cmp == Ordering::Equal {
            return path_cmp;
        }

        // Sort by major version (descending)
        match b.major_version.cmp(&a.major_version) {
            Ordering::Equal => {
                // Then by 64-bit (64-bit first)
                match b.is_64bit.cmp(&a.is_64bit) {
                    Ordering::Equal => path_cmp,
                    other => other,
                }
            }
            other => other,
        }
    });

    installations.dedup_by(|a, b| a.path == b.path);

    info!("Found {} unique Java installations", installations.len());

    // Cache the results
    {
        let mut cache = JAVA_INSTALLATIONS.write().await;
        *cache = Some(installations.clone());
    }

    Ok(installations)
}

/// Gets information about a Java installation at the given path
pub async fn get_java_info(java_path: &Path) -> Result<JavaInstallation> {
    let java_path = if java_path.is_dir() {
        let java_exe = match OS {
            OperatingSystem::WINDOWS => "java.exe",
            _ => "java",
        };

        java_path.join("bin").join(java_exe)
    } else {
        java_path.to_path_buf()
    };

    if !java_path.exists() {
        return Err(AppError::Other(format!(
            "Java path does not exist: {}",
            java_path.display()
        )));
    }

    // Run java -version and parse the output
    let mut cmd = Command::new(&java_path);
    cmd.arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| AppError::Other(format!("Failed to execute java -version: {}", e)))?;

    // Java outputs version info to stderr
    let version_output = String::from_utf8_lossy(&output.stderr);

    // Parse the version string
    let version_regex = Regex::new(r#"version "([^"]+)""#).unwrap();
    let vendor_regex =
        Regex::new(r#"(OpenJDK|Oracle|AdoptOpenJDK|Azul|Eclipse|GraalVM).*"#).unwrap();
    let vm_regex = Regex::new(r#"(HotSpot|OpenJ9|J9|GraalVM).*"#).unwrap();
    let bit_regex = Regex::new(r#"(64-Bit|x86_64|amd64)"#).unwrap();

    let version = version_regex
        .captures(&version_output)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            AppError::Other(format!(
                "Failed to parse Java version from: {}",
                version_output
            ))
        })?;

    // Parse the major version
    let major_version = parse_java_major_version(&version).ok_or_else(|| {
        AppError::Other(format!(
            "Failed to parse Java major version from: {}",
            version
        ))
    })?;

    // Determine vendor
    let vendor = vendor_regex
        .captures(&version_output)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    // Determine VM
    let vm_name = vm_regex
        .captures(&version_output)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string());

    // Determine if 64-bit
    let is_64bit = bit_regex.is_match(&version_output);

    // Determine architecture
    let architecture = if is_64bit {
        Architecture::X64
    } else {
        Architecture::X86
    };

    Ok(JavaInstallation {
        path: java_path,
        version,
        major_version,
        is_64bit,
        vendor,
        vm_name,
        source: "Manual".to_string(), // Default for individual queries
        architecture,
    })
}

/// Finds the best Java installation for the given Minecraft version
pub async fn find_best_java_for_minecraft(mc_version: &str) -> Result<Option<JavaInstallation>> {
    let installations = detect_java_installations().await?;

    if installations.is_empty() {
        return Ok(None);
    }

    // First try to find a recommended version
    let recommended = installations
        .iter()
        .filter(|java| java.is_recommended_for_minecraft(mc_version))
        .max_by_key(|java| (java.major_version, java.is_64bit))
        .cloned();

    if recommended.is_some() {
        return Ok(recommended);
    }

    // If no recommended version, find any suitable version
    let suitable = installations
        .iter()
        .filter(|java| java.is_suitable_for_minecraft())
        .max_by_key(|java| (java.major_version, java.is_64bit))
        .cloned();

    Ok(suitable)
}

/// Parses the major version from a Java version string
fn parse_java_major_version(version: &str) -> Option<u32> {
    // Handle different version formats:
    // 1.8.0_292 (Java 8)
    // 11.0.11 (Java 11)
    // 17.0.1 (Java 17)

    let parts: Vec<&str> = version.split('.').collect();
    if parts.is_empty() {
        return None;
    }

    let first_part = parts[0].parse::<u32>().ok()?;

    if first_part == 1 && parts.len() > 1 {
        // Old format: 1.8.0_292 -> Java 8
        parts[1].parse::<u32>().ok()
    } else {
        // New format: 11.0.11 -> Java 11
        Some(first_part)
    }
}

/// Detects Java installations in the system PATH
async fn detect_java_in_system_path() -> Result<Vec<JavaInstallation>> {
    info!("Detecting Java installations in PATH");
    let mut installations = Vec::new();

    // Get the PATH environment variable
    let path_var = std::env::var("PATH").unwrap_or_default();
    let path_separator = match OS {
        OperatingSystem::WINDOWS => ";",
        _ => ":",
    };

    // Split the PATH by the separator
    for path in path_var.split(path_separator) {
        let path = Path::new(path);

        // Check if java exists in this directory
        let java_exe = match OS {
            OperatingSystem::WINDOWS => "java.exe",
            _ => "java",
        };

        let java_path = path.join(java_exe);
        if java_path.exists() {
            match get_java_info(&java_path).await {
                Ok(mut info) => {
                    info.source = "PATH".to_string();
                    installations.push(info);
                }
                Err(e) => warn!(
                    "Failed to get info for Java in PATH {}: {}",
                    java_path.display(),
                    e
                ),
            }
        }
    }

    Ok(installations)
}

/// Detects Java installations on Windows
async fn detect_java_on_windows() -> Result<Vec<JavaInstallation>> {
    info!("Detecting Java installations on Windows");
    let mut installations = Vec::new();

    // Common locations to check on Windows
    let locations = vec![
        // Oracle/OpenJDK
        PathBuf::from("C:\\Program Files\\Java"),
        PathBuf::from("C:\\Program Files (x86)\\Java"),
        // AdoptOpenJDK / Eclipse Adoptium
        PathBuf::from("C:\\Program Files\\AdoptOpenJDK"),
        PathBuf::from("C:\\Program Files (x86)\\AdoptOpenJDK"),
        PathBuf::from("C:\\Program Files\\Eclipse Adoptium"),
        PathBuf::from("C:\\Program Files (x86)\\Eclipse Adoptium"),
        // Amazon Corretto
        PathBuf::from("C:\\Program Files\\Amazon Corretto"),
        PathBuf::from("C:\\Program Files (x86)\\Amazon Corretto"),
        // Microsoft
        PathBuf::from("C:\\Program Files\\Microsoft\\jdk"),
        PathBuf::from("C:\\Program Files (x86)\\Microsoft\\jdk"),
        // BellSoft Liberica
        PathBuf::from("C:\\Program Files\\BellSoft"),
        PathBuf::from("C:\\Program Files (x86)\\BellSoft"),
        // Zulu
        PathBuf::from("C:\\Program Files\\Zulu"),
        PathBuf::from("C:\\Program Files (x86)\\Zulu"),
    ];

    for location in locations {
        if !location.exists() {
            continue;
        }

        // Try to list all directories in this location
        match fs::read_dir(&location).await {
            Ok(mut read_dir) => {
                while let Ok(Some(entry)) = read_dir.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        // Check if there's a bin/java.exe
                        let java_exe = path.join("bin").join("java.exe");
                        if java_exe.exists() {
                            match get_java_info(&java_exe).await {
                                Ok(mut info) => {
                                    info.source = format!("Windows ({})", location.display());
                                    installations.push(info);
                                }
                                Err(e) => warn!(
                                    "Failed to get info for Java at {}: {}",
                                    java_exe.display(),
                                    e
                                ),
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Failed to read directory {}: {}", location.display(), e),
        }
    }

    // Also check Windows Registry for Java installations
    // This is more complex and would require a separate implementation

    Ok(installations)
}

/// Detects Java installations on macOS
async fn detect_java_on_macos() -> Result<Vec<JavaInstallation>> {
    info!("Detecting Java installations on macOS");
    let mut installations = Vec::new();

    // Common locations to check on macOS
    let locations = vec![
        // System Java
        PathBuf::from("/Library/Java/JavaVirtualMachines"),
        PathBuf::from("/System/Library/Java/JavaVirtualMachines"),
        // User Java
        PathBuf::from(format!(
            "{}/Library/Java/JavaVirtualMachines",
            std::env::var("HOME").unwrap_or_default()
        )),
    ];

    for location in locations {
        if !location.exists() {
            continue;
        }

        // Try to list all directories in this location
        match fs::read_dir(&location).await {
            Ok(mut read_dir) => {
                while let Ok(Some(entry)) = read_dir.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        // Check for Home/bin/java
                        let java_home = path.join("Contents").join("Home");
                        let java_exe = java_home.join("bin").join("java");
                        if java_exe.exists() {
                            match get_java_info(&java_exe).await {
                                Ok(mut info) => {
                                    info.source = format!("macOS ({})", location.display());
                                    installations.push(info);
                                }
                                Err(e) => warn!(
                                    "Failed to get info for Java at {}: {}",
                                    java_exe.display(),
                                    e
                                ),
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Failed to read directory {}: {}", location.display(), e),
        }
    }

    // Also try to detect using the /usr/libexec/java_home command
    match Command::new("/usr/libexec/java_home").arg("-V").output() {
        Ok(output) => {
            let output_str = String::from_utf8_lossy(&output.stderr);
            for line in output_str.lines() {
                if let Some(start) = line.find('"') {
                    if let Some(end) = line[start + 1..].find('"') {
                        let version = &line[start + 1..start + 1 + end];
                        if let Ok(path_output) = Command::new("/usr/libexec/java_home")
                            .arg("-v")
                            .arg(version)
                            .output()
                        {
                            let path_str = String::from_utf8_lossy(&path_output.stdout)
                                .trim()
                                .to_string();
                            let java_exe = Path::new(&path_str).join("bin").join("java");
                            if java_exe.exists() {
                                match get_java_info(&java_exe).await {
                                    Ok(mut info) => {
                                        info.source = "java_home command".to_string();
                                        installations.push(info);
                                    }
                                    Err(e) => warn!(
                                        "Failed to get info for Java at {}: {}",
                                        java_exe.display(),
                                        e
                                    ),
                                }
                            }
                        }
                    }
                }
            }
        }
        Err(e) => warn!("Failed to run java_home command: {}", e),
    }

    Ok(installations)
}

/// Detects Java installations on Linux
async fn detect_java_on_linux() -> Result<Vec<JavaInstallation>> {
    info!("Detecting Java installations on Linux");
    let mut installations = Vec::new();

    // Common locations to check on Linux
    let locations = vec![
        // System packages
        PathBuf::from("/usr/lib/jvm"),
        // User installations
        PathBuf::from("/opt/java"),
        PathBuf::from("/opt/jdk"),
        PathBuf::from("/opt/openjdk"),
    ];

    for location in locations {
        if !location.exists() {
            continue;
        }

        // Try to list all directories in this location
        match fs::read_dir(&location).await {
            Ok(mut read_dir) => {
                while let Ok(Some(entry)) = read_dir.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        // Check for bin/java
                        let java_exe = path.join("bin").join("java");
                        if java_exe.exists() {
                            match get_java_info(&java_exe).await {
                                Ok(mut info) => {
                                    info.source = format!("Linux ({})", location.display());
                                    installations.push(info);
                                }
                                Err(e) => warn!(
                                    "Failed to get info for Java at {}: {}",
                                    java_exe.display(),
                                    e
                                ),
                            }
                        }
                    }
                }
            }
            Err(e) => warn!("Failed to read directory {}: {}", location.display(), e),
        }
    }

    // Also try to detect using common system commands
    // 1. Try update-alternatives
    match Command::new("update-alternatives")
        .arg("--list")
        .arg("java")
        .output()
    {
        Ok(output) => {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                let java_path = line.trim();
                if !java_path.is_empty() {
                    let java_exe = PathBuf::from(java_path);
                    if java_exe.exists() {
                        match get_java_info(&java_exe).await {
                            Ok(mut info) => {
                                info.source = "update-alternatives".to_string();
                                installations.push(info);
                            }
                            Err(e) => warn!(
                                "Failed to get info for Java at {}: {}",
                                java_exe.display(),
                                e
                            ),
                        }
                    }
                }
            }
        }
        Err(e) => warn!("Failed to run update-alternatives command: {}", e),
    }

    // 2. Try which
    match Command::new("which").arg("-a").arg("java").output() {
        Ok(output) => {
            let output_str = String::from_utf8_lossy(&output.stdout);
            for line in output_str.lines() {
                let java_path = line.trim();
                if !java_path.is_empty() {
                    let java_exe = PathBuf::from(java_path);
                    if java_exe.exists() {
                        match get_java_info(&java_exe).await {
                            Ok(mut info) => {
                                info.source = "which command".to_string();
                                installations.push(info);
                            }
                            Err(e) => warn!(
                                "Failed to get info for Java at {}: {}",
                                java_exe.display(),
                                e
                            ),
                        }
                    }
                }
            }
        }
        Err(e) => warn!("Failed to run which command: {}", e),
    }

    Ok(installations)
}

/// Invalidates the Java installation cache, forcing a fresh scan on the next query
pub async fn invalidate_java_cache() {
    info!("Invalidating Java installation cache");
    let mut cache = JAVA_INSTALLATIONS.write().await;
    *cache = None;
}

/// Returns the executable name for Java based on the current OS
pub fn get_java_executable_name() -> &'static str {
    match OS {
        OperatingSystem::WINDOWS => "java.exe",
        _ => "java",
    }
}
