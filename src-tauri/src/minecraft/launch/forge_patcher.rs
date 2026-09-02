use std::path::PathBuf;

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::forge_install_profile::{ForgeInstallProfile, ForgeProcessor};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::state_manager::State;
use async_zip::tokio::read::seek::ZipFileReader;
use log::info;
use tokio::fs::File;
use tokio::io::BufReader;
use uuid::Uuid;

pub struct ForgePatcher {
    library_path: PathBuf,
    java_path: PathBuf,
    minecraft_jar_path: PathBuf,
    minecraft_version: String,
    root_path: PathBuf,
    event_id: Option<Uuid>,
    profile_id: Option<Uuid>,
}

impl ForgePatcher {
    pub fn new(java_path: PathBuf, minecraft_version: &str) -> Self {
        let library_path = LAUNCHER_DIRECTORY.meta_dir().join("libraries");
        let root_path = LAUNCHER_DIRECTORY.meta_dir().to_path_buf();
        let minecraft_jar_path = LAUNCHER_DIRECTORY
            .meta_dir()
            .join("versions")
            .join(minecraft_version)
            .join(format!("{}.jar", minecraft_version));

        Self {
            library_path,
            java_path,
            minecraft_jar_path,
            minecraft_version: minecraft_version.to_string(),
            root_path,
            event_id: None,
            profile_id: None,
        }
    }

    pub fn with_event_id(mut self, event_id: Uuid) -> Self {
        self.event_id = Some(event_id);
        self
    }

    pub fn with_profile_id(mut self, profile_id: Uuid) -> Self {
        self.profile_id = Some(profile_id);
        self
    }

    fn replace_tokens(
        &self,
        arg: &str,
        install_profile: &ForgeInstallProfile,
        is_client: bool,
        installer_path: &PathBuf,
    ) -> Result<String> {
        let mut result = String::new();
        let mut chars = arg.chars().peekable();

        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    if let Some(next) = chars.next() {
                        result.push(next);
                    } else {
                        return Err(AppError::ForgeError(
                            "Illegal pattern (Bad escape)".to_string(),
                        ));
                    }
                }
                '{' | '\'' => {
                    let mut key = String::new();
                    let mut found_end = false;

                    while let Some(d) = chars.next() {
                        match d {
                            '\\' => {
                                if let Some(next) = chars.next() {
                                    key.push(next);
                                } else {
                                    return Err(AppError::ForgeError(
                                        "Illegal pattern (Bad escape)".to_string(),
                                    ));
                                }
                            }
                            '}' if c == '{' => {
                                found_end = true;
                                break;
                            }
                            '\'' if c == '\'' => {
                                found_end = true;
                                break;
                            }
                            _ => key.push(d),
                        }
                    }

                    if !found_end {
                        return Err(AppError::ForgeError(format!(
                            "Illegal pattern (Unclosed {}): {}",
                            c, arg
                        )));
                    }

                    if c == '\'' {
                        result.push_str(&key);
                    } else {
                        if let Some(value) = install_profile.data.get(&key) {
                            let replacement = if is_client {
                                &value.client
                            } else {
                                &value.server
                            };
                            info!("Replacing {} with: {}", key, replacement);
                            result.push_str(replacement);
                        } else {
                            match key.as_str() {
                                "SIDE" => {
                                    let side = if is_client { "client" } else { "server" };
                                    info!("Replacing {{SIDE}} with: {}", side);
                                    result.push_str(side);
                                }
                                "MINECRAFT_JAR" => {
                                    let path = self.minecraft_jar_path.to_string_lossy();
                                    info!("Replacing {{MINECRAFT_JAR}} with: {}", path);
                                    result.push_str(&path);
                                }
                                "ROOT" => {
                                    let path = self.root_path.to_string_lossy();
                                    info!("Replacing {{ROOT}} with: {}", path);
                                    result.push_str(&path);
                                }
                                // Only server-side processors use these today, but an unknown
                                // token is a hard error below, so a future version shipping one
                                // client-side would otherwise fail to install.
                                "MINECRAFT_VERSION" => {
                                    info!(
                                        "Replacing {{MINECRAFT_VERSION}} with: {}",
                                        self.minecraft_version
                                    );
                                    result.push_str(&self.minecraft_version);
                                }
                                "LIBRARY_DIR" => {
                                    let path = self.library_path.to_string_lossy();
                                    info!("Replacing {{LIBRARY_DIR}} with: {}", path);
                                    result.push_str(&path);
                                }
                                "INSTALLER" => {
                                    let path = installer_path.to_string_lossy();
                                    info!("Replacing {{INSTALLER}} with: {}", path);
                                    result.push_str(&path);
                                }
                                _ => {
                                    return Err(AppError::ForgeError(format!(
                                        "Missing key: {}",
                                        key
                                    )))
                                }
                            }
                        }
                    }
                }
                _ => result.push(c),
            }
        }

        Ok(result)
    }

    fn parse_arguments(
        &self,
        install_profile: &ForgeInstallProfile,
        processor: &ForgeProcessor,
        is_client: bool,
        installer_path: &PathBuf,
    ) -> Result<Vec<String>> {
        let mut parsed_args = Vec::new();

        if let Some(args) = &processor.args {
            info!("Processing arguments for processor:");
            for arg in args {
                info!("Processing argument: {}", arg);

                // First handle token replacement
                let processed =
                    self.replace_tokens(arg, install_profile, is_client, installer_path)?;
                info!("After token replacement: {}", processed);

                // Then check if the result is an artifact or data path
                let final_arg = if processed.starts_with('[') && processed.ends_with(']') {
                    let artifact_str = &processed[1..processed.len() - 1];
                    info!("Found artifact: {}", artifact_str);
                    match self.get_library_path(artifact_str) {
                        Ok(path) => {
                            let path_str = path.to_string_lossy().to_string();
                            info!("Resolved artifact path: {}", path_str);
                            path_str
                        }
                        Err(e) => {
                            info!("Failed to resolve artifact path: {:?}", e);
                            processed
                        }
                    }
                } else if processed.starts_with("/data/") {
                    // Handle data paths by using the installer directory
                    info!("Found data path: {}", processed);

                    // Use the installer directory
                    let installer_dir = installer_path.parent().unwrap();
                    let full_path = installer_dir.join(&processed[1..]); // Remove leading slash

                    info!("Full data path: {}", full_path.display());
                    full_path.to_string_lossy().to_string()
                } else {
                    processed
                };

                parsed_args.push(final_arg);
            }
        }

        info!("Final parsed arguments: {:?}", parsed_args);
        Ok(parsed_args)
    }

    fn get_library_path(&self, library: &str) -> Result<PathBuf> {
        info!("=== get_library_path Debug ===");
        info!("Input library string: {}", library);

        // Remove square brackets if present
        let library = if library.starts_with('[') && library.ends_with(']') {
            &library[1..library.len() - 1]
        } else {
            library
        };
        info!("Library after removing brackets: {}", library);

        let parts: Vec<&str> = library.split(':').collect();
        info!("Split parts: {:?}", parts);

        if parts.len() < 3 {
            return Err(AppError::ForgeError("Invalid library name".to_string()));
        }

        let (group, artifact, version) = (parts[0], parts[1], parts[2]);
        // Use platform-specific separator
        let group_path = if cfg!(windows) {
            group.replace('.', "\\")
        } else {
            group.replace('.', "/")
        };
        info!("Group path: {}", group_path);

        // Handle version with @zip
        let (version, extension) = if version.contains('@') {
            let (v, ext) = version.split_once('@').unwrap();
            (v.to_string(), ext.to_string())
        } else {
            (version.to_string(), "jar".to_string())
        };

        // Handle classifier and extension if present
        let (classifier, extension) = if let Some(classifier_part) = parts.get(3) {
            info!("Classifier part: {}", classifier_part);
            if let Some((classifier, ext)) = classifier_part.split_once('@') {
                info!("Split classifier: {}, extension: {}", classifier, ext);
                (Some(classifier.to_string()), ext.to_string())
            } else {
                info!("No extension found, using default 'jar'");
                (Some(classifier_part.to_string()), extension)
            }
        } else {
            info!("No classifier part found");
            (None, extension)
        };

        // Build the filename
        let mut filename = format!("{}-{}", artifact, version);
        if let Some(classifier) = &classifier {
            filename.push_str(&format!("-{}", classifier));
        }
        filename.push_str(&format!(".{}", extension));
        info!("Final filename: {}", filename);

        let path = self
            .library_path
            .join(&group_path)
            .join(artifact)
            .join(version)
            .join(filename);

        info!("Final path: {}", path.display());
        info!("Path exists: {}", path.exists());
        info!("=== End Debug ===");

        Ok(path)
    }

    fn build_classpath(&self, processor: &ForgeProcessor) -> Result<String> {
        let mut paths = Vec::new();

        // Add additional classpath entries if they exist
        if let Some(classpath) = &processor.classpath {
            for path in classpath {
                paths.push(self.get_library_path(path)?);
            }
        }

        // Convert to string with system-specific path separator
        let classpath_str = paths
            .iter()
            .map(|p| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join(if cfg!(windows) { ";" } else { ":" });

        info!("Built classpath: {}", classpath_str);
        Ok(classpath_str)
    }

    async fn get_main_class_from_jar(&self, jar_path: &PathBuf) -> Result<String> {
        let mut file = BufReader::new(File::open(jar_path).await?);
        let mut zip = ZipFileReader::with_tokio(&mut file)
            .await
            .map_err(|e| AppError::ForgeError(format!("Failed to read JAR as ZIP: {}", e)))?;

        let mut manifest_content = String::new();
        let mut found = false;

        for index in 0..zip.file().entries().len() {
            let entry = &zip.file().entries().get(index).unwrap();
            let file_name = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::ForgeError(format!("Failed to get filename: {}", e)))?;

            if file_name == "META-INF/MANIFEST.MF" {
                found = true;
                let mut reader = zip.reader_with_entry(index).await.map_err(|e| {
                    AppError::ForgeError(format!("Failed to read manifest entry: {}", e))
                })?;

                reader
                    .read_to_string_checked(&mut manifest_content)
                    .await
                    .map_err(|e| {
                        AppError::ForgeError(format!("Failed to read manifest content: {}", e))
                    })?;
                break;
            }
        }

        if !found {
            return Err(AppError::ForgeError(
                "MANIFEST.MF not found in JAR".to_string(),
            ));
        }

        // Parse the manifest to find Main-Class
        for line in manifest_content.lines() {
            if line.starts_with("Main-Class:") {
                return Ok(line
                    .split(": ")
                    .nth(1)
                    .ok_or_else(|| AppError::ForgeError("Invalid manifest format".to_string()))?
                    .trim()
                    .to_string());
            }
        }

        Err(AppError::ForgeError(
            "Main-Class not found in manifest".to_string(),
        ))
    }

    pub async fn apply_processors(
        &self,
        install_profile: &ForgeInstallProfile,
        _minecraft_version: &str,
        is_client: bool,
        installer_path: &PathBuf,
    ) -> Result<()> {
        info!(
            "Applying Forge processors for {}...",
            if is_client { "client" } else { "server" }
        );

        let state = State::get().await?;
        let total_processors = install_profile.processors.len();

        for (i, processor) in install_profile.processors.iter().enumerate() {
            // Filter nach Side
            if let Some(sides) = &processor.sides {
                let is_processor_for_side = if is_client {
                    sides.contains(&"client".to_string())
                } else {
                    sides.contains(&"server".to_string())
                };

                if !is_processor_for_side {
                    continue;
                }
            }

            if let Some(event_id) = self.event_id {
                if let Some(profile_id) = self.profile_id {
                    let progress = (i as f64) / (total_processors as f64);
                    state
                        .emit_event(EventPayload {
                            event_id,
                            event_type: EventType::InstallingForge,
                            target_id: Some(profile_id),
                            message: format!(
                                "Forge Processor: {} ({}/{})",
                                processor.jar,
                                i + 1,
                                total_processors
                            ),
                            progress: Some(progress),
                            error: None,
                        })
                        .await?;
                }
            }

            info!("Processor: {:?}", processor);

            // Print Sides
            if let Some(sides) = &processor.sides {
                info!("  Sides: {:?}", sides);
            }

            // Print JAR
            info!("JAR: {}", processor.jar);

            // Print Classpath
            if let Some(classpath) = &processor.classpath {
                info!("  Classpath:");
                for path in classpath {
                    info!("    - {}", path);
                }
            }

            // Get the JAR path from libraries
            let jar_path = self.get_library_path(&processor.jar)?;
            info!("JAR Path: {}", jar_path.display());
            let main_class = self.get_main_class_from_jar(&jar_path).await?;
            info!("Main Class: {}", main_class);

            // Build classpath including the processor JAR
            let mut classpath = self.build_classpath(processor)?;
            let separator = if cfg!(windows) { ";" } else { ":" };
            classpath = format!("{}{}{}", classpath, separator, jar_path.display());
            info!("Full Classpath: {}", classpath);

            let jvm_arguments =
                self.parse_arguments(install_profile, processor, is_client, installer_path)?;
            info!("JVM Arguments: {:?}", jvm_arguments);

            // Execute the processor
            let mut command = std::process::Command::new(&self.java_path);

            // Add classpath
            command.arg("-cp").arg(classpath);

            // Add main class
            command.arg(main_class);

            // Add JVM arguments
            for arg in jvm_arguments {
                command.arg(arg);
            }

            info!("Executing command: {:?}", command);

            let output = command.output()?;
            if !output.status.success() {
                return Err(AppError::ForgeError(format!(
                    "Processor failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                )));
            }

            info!(
                "Processor output: {}",
                String::from_utf8_lossy(&output.stdout)
            );

            // Print Outputs
            if let Some(outputs) = &processor.outputs {
                info!("  Outputs:");
                for (key, value) in outputs {
                    info!("    {}: {}", key, value);
                }
            }
        }

        Ok(())
    }
}
