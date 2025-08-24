use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::piston_meta::PistonMeta;
use crate::minecraft::minecraft_auth::Credentials;
use crate::minecraft::ClasspathBuilder;
use crate::minecraft::GameArguments;
use crate::minecraft::JvmArguments;
use crate::state::profile_state::{Profile, WindowSize};
use crate::state::state_manager::State;
use log::{debug, error, info, warn};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;
use tauri::Manager;
use uuid::Uuid;

pub struct MinecraftLaunchParameters {
    pub main_class: String,
    pub additional_libraries: Vec<PathBuf>,
    pub additional_jvm_args: Vec<String>,
    pub additional_game_args: Vec<String>,
    pub custom_client_jar: Option<PathBuf>,
    pub old_minecraft_arguments: Option<String>,
    pub force_include_minecraft_jar: bool,
    pub profile_id: Uuid,
    pub memory_max_mb: u32,
    pub is_experimental_mode: bool,
    pub resolution: Option<WindowSize>,
    pub quick_play_singleplayer: Option<String>,
    pub quick_play_multiplayer: Option<String>,
}

impl MinecraftLaunchParameters {
    pub fn new(profile_id: Uuid, memory_max_mb: u32) -> Self {
        Self {
            main_class: String::new(),
            additional_libraries: Vec::new(),
            additional_jvm_args: Vec::new(),
            additional_game_args: Vec::new(),
            custom_client_jar: None,
            old_minecraft_arguments: None,
            force_include_minecraft_jar: false,
            profile_id,
            memory_max_mb,
            is_experimental_mode: false,
            resolution: None,
            quick_play_singleplayer: None,
            quick_play_multiplayer: None,
        }
    }

    pub fn with_main_class(mut self, main_class: &str) -> Self {
        self.main_class = main_class.to_string();
        self
    }

    pub fn with_additional_libraries(mut self, libraries: Vec<PathBuf>) -> Self {
        self.additional_libraries = libraries;
        self
    }

    pub fn with_additional_jvm_args(mut self, args: Vec<String>) -> Self {
        self.additional_jvm_args = args;
        self
    }

    pub fn with_additional_game_args(mut self, args: Vec<String>) -> Self {
        self.additional_game_args = args;
        self
    }

    pub fn with_custom_client_jar(mut self, jar_path: PathBuf) -> Self {
        self.custom_client_jar = Some(jar_path);
        self
    }

    pub fn with_old_minecraft_arguments(mut self, args: Option<String>) -> Self {
        self.old_minecraft_arguments = args;
        self
    }

    pub fn with_force_include_minecraft_jar(mut self, force: bool) -> Self {
        self.force_include_minecraft_jar = force;
        self
    }

    pub fn with_memory_max_mb(mut self, memory: u32) -> Self {
        self.memory_max_mb = memory;
        self
    }

    pub fn with_experimental_mode(mut self, is_experimental: bool) -> Self {
        self.is_experimental_mode = is_experimental;
        self
    }

    pub fn with_resolution(mut self, res: Option<WindowSize>) -> Self {
        self.resolution = res;
        self
    }

    pub fn with_quick_play_singleplayer(mut self, world_name: String) -> Self {
        self.quick_play_singleplayer = Some(world_name);
        self
    }

    pub fn with_quick_play_multiplayer(mut self, server_address: String) -> Self {
        self.quick_play_multiplayer = Some(server_address);
        self
    }
}

pub struct MinecraftLauncher {
    java_path: PathBuf,
    game_directory: PathBuf,
    credentials: Option<Credentials>,
}

impl MinecraftLauncher {
    pub fn new(
        java_path: PathBuf,
        game_directory: PathBuf,
        credentials: Option<Credentials>,
    ) -> Self {
        Self {
            java_path,
            game_directory,
            credentials,
        }
    }

    fn process_old_arguments(
        &self,
        minecraft_arguments: Option<String>,
        piston_meta: &PistonMeta,
    ) -> Option<Vec<String>> {
        minecraft_arguments.map(|args_string| {
            info!("\nProcessing old format arguments (with advanced splitting):");

            // 1. Create the helper to resolve variables
            let game_args_resolver = GameArguments::new(
                self.credentials.clone(),
                piston_meta.id.clone(),
                self.game_directory.clone(),
                piston_meta.version_type.clone(),
                piston_meta.asset_index.id.clone(),
            );

            // 2. Split the *original* string by whitespace
            let tokens = args_string.split_whitespace();

            // 3. Iterate and replace variables in each token
            let mut processed_args: Vec<String> = Vec::new();
            for token in tokens {
                // Use the resolver's method for each token
                processed_args.push(game_args_resolver.replace_variables(token));
            }

            info!("Processed old arguments: {:?}", processed_args);
            processed_args
        })
    }

    // Helper function to create a loggable string from a Command, redacting sensitive info.
    fn create_loggable_command_string(command: &std::process::Command) -> String {
        let mut parts: Vec<String> = Vec::new();

        // Program
        let program_os_str = command.get_program();
        let program_str = program_os_str.to_string_lossy();
        if program_str.contains(' ') || program_str.contains('\"') {
            // Quote if contains space or quote
            parts.push(format!("\"{}\"", program_str.replace('\"', "\\\"")));
        } else {
            parts.push(program_str.into_owned());
        }

        // Arguments
        let mut args_iter = command.get_args().peekable();
        while let Some(arg_os_str) = args_iter.next() {
            let mut arg_str = arg_os_str.to_string_lossy().into_owned();

            if arg_str.starts_with("-Dnorisk.token=") {
                parts.push("-Dnorisk.token=*****".to_string());
            } else if arg_str == "--accessToken" {
                parts.push(arg_str); // Push "--accessToken"
                if args_iter.peek().is_some() {
                    args_iter.next(); // Consume the actual token value
                    parts.push("*****".to_string()); // Push the redacted placeholder
                }
            } else {
                // Quote if contains space, is empty, or contains a double quote itself.
                // The check for double quote in arg_str itself is important to ensure it gets quoted.
                if arg_str.contains(' ') || arg_str.is_empty() || arg_str.contains('\"') {
                    parts.push(format!("\"{}\"", arg_str.replace('\"', "\\\"")));
                // Escape inner quotes
                } else {
                    parts.push(arg_str);
                }
            }
        }
        parts.join(" ")
    }

    pub async fn launch(
        &self,
        piston_meta: &PistonMeta,
        params: MinecraftLaunchParameters,
        profile: Option<Profile>,
    ) -> Result<()> {
        let state = State::get().await?;
        let process_manager = &state.process_manager;

        // Remove fetching the profile just for RAM
        // let profile = state.profile_manager.get_profile(params.profile_id).await?;
        // let settings = &profile.settings;

        // 2. Java-Befehl initialisieren (mit wrapper support)
        let launcher_config = state.config_manager.get_config().await;
        let mut command = match launcher_config.hooks.wrapper {
            Some(wrapper) => {
                info!("Using wrapper command: {}", wrapper);
                // Exactly like Modrinth: use the whole wrapper string as command and add java path as arg
                {
                    let mut it = Command::new(wrapper);
                    it.arg(&self.java_path);
                    it
                }
            }
            None => Command::new(&self.java_path),
        };
        command.current_dir(&self.game_directory);

        // Define paths
        let natives_path = LAUNCHER_DIRECTORY.meta_dir()
            .join("natives")
            .join(&piston_meta.id);

        // Build classpath first as it's needed for JVM arguments
        let classpath = if let Some(client_jar) = params.custom_client_jar {
            ClasspathBuilder::new(&piston_meta.id)
                .add_additional_libraries(&params.additional_libraries, 1)
                .add_piston_libraries(&piston_meta.libraries)
                .set_custom_client_jar(client_jar)
                .build(params.force_include_minecraft_jar)
        } else {
            ClasspathBuilder::new(&piston_meta.id)
                .add_additional_libraries(&params.additional_libraries, 1)
                .add_piston_libraries(&piston_meta.libraries)
                .build(params.force_include_minecraft_jar)
        };

        // Create JVM arguments processor
        let jvm_args = JvmArguments::new(
            natives_path.clone(),
            "noriskclient-launcher".to_string(),
            "3.0.0".to_string(),
            classpath.clone(),
        );

        // Process and add JVM arguments
        info!("\nProcessing JVM arguments:");
        let mut has_classpath = false;
        let mut has_natives = false;

        if let Some(arguments) = &piston_meta.arguments {
            let processed_jvm_args = jvm_args.process_arguments(&arguments.jvm);
            for arg in &processed_jvm_args {
                command.arg(arg);
                if arg == "-cp" {
                    has_classpath = true;
                }
                if arg.starts_with("-Djava.library.path=") {
                    has_natives = true;
                }
            }
        }

        info!("Adding RAM JVM argument: -Xmx{}M", params.memory_max_mb);
        command.arg(format!("-Xmx{}M", params.memory_max_mb));

        // Add recommended GC flags
        command.arg("-XX:+UnlockExperimentalVMOptions");
        command.arg("-XX:+UseG1GC");
        // Add additional G1GC optimization flags like vanilla launcher
        command.arg("-XX:G1NewSizePercent=20");
        command.arg("-XX:G1ReservePercent=20");
        command.arg("-XX:MaxGCPauseMillis=50");
        command.arg("-XX:G1HeapRegionSize=32M");

        // Add NoRisk client specific parameters
        if let Some(creds) = &self.credentials {
            // Get the appropriate NoRisk token based on experimental mode setting
            if let Some(norisk_token) = if params.is_experimental_mode {
                info!("[NoRisk Launcher] Using experimental mode token");
                creds
                    .norisk_credentials
                    .experimental
                    .as_ref()
                    .map(|t| &t.value)
            } else {
                info!("[NoRisk Launcher] Using production mode token");
                creds
                    .norisk_credentials
                    .production
                    .as_ref()
                    .map(|t| &t.value)
            } {
                info!("[NoRisk Launcher] Adding NoRisk token to launch parameters");
                command.arg(format!("-Dnorisk.token={}", norisk_token));
            } else {
                info!("[NoRisk Launcher] No NoRisk token available for the selected mode");
            }

            // Add experimental mode parameter
            info!(
                "[NoRisk Launcher] Setting experimental mode: {}",
                params.is_experimental_mode
            );
            command.arg(format!(
                "-Dnorisk.experimental={}",
                params.is_experimental_mode
            ));
        } else {
            info!("[NoRisk Launcher] No credentials available, skipping NoRisk parameters");
        }

        // Add Fabric specific mods folder argument if loader is Fabric
        // Note: When using -Dfabric.addMods (prototype), this is still harmless and allows user mods in mods/.
        if let Some(p_ref) = &profile {
            if p_ref.loader == crate::state::profile_state::ModLoader::Fabric {
                match state.profile_manager.get_profile_mods_path(p_ref) {
                    Ok(mods_path) => {
                        let mods_path_str = mods_path.to_string_lossy().replace("\\", "/");
                        let fabric_mods_arg = format!("-Dfabric.modsFolder={}", mods_path_str);
                        info!(
                            "Adding Fabric mods folder JVM argument: {}",
                            fabric_mods_arg
                        );
                        command.arg(fabric_mods_arg);
                    }
                    Err(e) => {
                        warn!(
                            "Could not get Fabric mods path for profile '{}' (ID: {}): {}. Fabric mods folder argument will not be set.",
                            p_ref.name, p_ref.id, e
                        );
                    }
                }
            }
        }

        // Add additional JVM arguments
        for arg in params.additional_jvm_args {
            command.arg(arg);
        }

        // Add classpath if not already set
        if !has_classpath {
            command.arg("-cp").arg(&classpath);
        }

        // Add natives path if not already set
        if !has_natives {
            command.arg(format!(
                "-Djava.library.path={}",
                natives_path.to_string_lossy().replace("\\", "/")
            ));
        }

        // Add main class
        command.arg(&params.main_class);

        // Create game arguments processor
        let game_args = GameArguments::new(
            self.credentials.clone(),
            piston_meta.id.clone(),
            self.game_directory.clone(),
            piston_meta.version_type.clone(),
            piston_meta.asset_index.id.clone(),
        );

        // Process and add game arguments
        if let Some(arguments) = &piston_meta.arguments {
            let processed_args = game_args.process_arguments(&arguments.game);
            for arg in processed_args {
                command.arg(arg);
            }
        } else if let Some(processed_args) =
            self.process_old_arguments(params.old_minecraft_arguments, piston_meta)
        {
            for arg in processed_args {
                command.arg(arg);
            }
        }

        // Add resolution arguments if custom resolution is set
        if let Some(res) = &params.resolution {
            info!(
                "Appending custom resolution arguments: --width {} --height {}",
                res.width, res.height
            );
            command.arg("--width");
            command.arg(res.width.to_string());
            command.arg("--height");
            command.arg(res.height.to_string());
        }

        // Add Quick Play arguments if specified
        if let Some(world_name) = &params.quick_play_singleplayer {
            info!(
                "Adding quickPlaySingleplayer argument for world: {}",
                world_name
            );
            command.arg("--quickPlaySingleplayer");
            command.arg(world_name);
        } else if let Some(server_address) = &params.quick_play_multiplayer {
            info!(
                "Adding quickPlayMultiplayer argument for server: {}",
                server_address
            );
            command.arg("--quickPlayMultiplayer");
            command.arg(server_address);
        }

        // Add additional game arguments (from profile's extra_game_args)
        for arg in params.additional_game_args {
            command.arg(arg);
        }

        // Log the command before execution, with sensitive information redacted.
        let loggable_command_view = Self::create_loggable_command_string(&command);
        info!("Executing command: {}", loggable_command_view);

        // Extract account information from credentials
        let (account_uuid, account_name) = if let Some(creds) = &self.credentials {
            (Some(creds.id.to_string()), Some(creds.username.clone()))
        } else {
            (None, None)
        };

        // Extract optional profile information for process metadata
        let (profile_loader, profile_loader_version, profile_norisk_pack, profile_name) =
            match profile {
                Some(p) => (
                    Some(p.loader.as_str().to_string()),
                    p.loader_version,
                    p.selected_norisk_pack_id,
                    Some(p.name),
                ),
                None => (None, None, None, None),
            };

        // Get post-exit hook from config at launch time (not at exit time)
        let launcher_config = state.config_manager.get_config().await;
        let post_exit_hook = launcher_config.hooks.post_exit.clone();

        // Start the process using ProcessManager with additional metadata
        process_manager
            .start_process(
                params.profile_id,
                command,
                account_uuid,
                account_name,
                Some(piston_meta.id.clone()),
                profile_loader,
                profile_loader_version,
                profile_norisk_pack,
                profile_name,
                post_exit_hook,
            )
            .await?;

        Ok(())
    }
}
