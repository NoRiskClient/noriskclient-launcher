use crate::minecraft::dto::neo_forge_meta::NeoForgeVersion;
use log::info;
use std::path::PathBuf;

pub struct NeoForgeArguments;

impl NeoForgeArguments {
    pub fn get_game_arguments(forge_version: &NeoForgeVersion) -> Vec<String> {
        if let Some(args) = &forge_version.arguments {
            args.game.clone()
        } else {
            Vec::new()
        }
    }

    pub fn get_jvm_arguments(
        forge_version: &NeoForgeVersion,
        library_directory: &PathBuf,
        version_name: &str,
    ) -> Vec<String> {
        if let Some(args) = &forge_version.arguments {
            let classpath_separator = if cfg!(windows) { ";" } else { ":" };
            let library_dir = library_directory.to_string_lossy().replace("\\", "/");

            info!("=== Forge JVM Arguments Debug ===");
            info!("Library Directory: {}", library_dir);
            info!("Classpath Separator: {}", classpath_separator);
            info!("Version Name: {}", version_name);

            args.jvm
                .iter()
                .map(|arg| {
                    info!("Original argument: {}", arg);
                    let replaced = arg
                        .replace("${library_directory}", &library_dir)
                        .replace("${classpath_separator}", classpath_separator)
                        .replace("${version_name}", version_name);
                    info!("Replaced argument: {}", replaced);
                    replaced
                })
                .collect()
        } else {
            Vec::new()
        }
    }
}
