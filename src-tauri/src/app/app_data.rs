use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Context;
use anyhow::Result;
use directories::UserDirs;
use log::debug;
use log::info;
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::LAUNCHER_DIRECTORY;

use super::modrinth_api::CustomMod;
use super::modrinth_api::Datapack;
use super::modrinth_api::ResourcePack;
use super::modrinth_api::Shader;

fn default_concurrent_downloads() -> i32 {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Addons {
    pub shaders: Vec<Shader>,
    #[serde(rename = "resourcePacks")]
    pub resourcepacks: Vec<ResourcePack>,
    pub datapacks: Vec<Datapack>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LauncherProfile {
    pub id: String,
    pub branch: String,
    pub name: String,
    pub mods: Vec<CustomMod>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub(crate) struct LauncherProfiles {
    #[serde(rename = "mainProfiles")]
    pub main_profiles: Vec<LauncherProfile>,
    #[serde(rename = "selectedMainProfiles")]
    pub selected_main_profiles: HashMap<String, String>,
    #[serde(rename = "experimentalProfiles")]
    pub experimental_profiles: Vec<LauncherProfile>,
    #[serde(rename = "selectedExperimentalProfiles")]
    pub selected_experimental_profiles: HashMap<String, String>,
    pub addons: HashMap<String, Addons>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ExportProfile {
    pub id: String,
    pub branch: String,
    pub name: String,
    pub mods: Vec<CustomMod>,
    pub addons: Addons,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChangeLog {
    pub version: String,
    pub date: String,
    pub changes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Announcement {
    pub author: String,
    pub date: String,
    pub title: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct LastViewedPopups {
    pub changelog: String,
    pub announcements: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct LatestRunningGame {
    pub id: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LauncherOptions {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "experimentalMode")]
    pub experimental_mode: bool,
    #[serde(rename = "multipleInstances")]
    pub multiple_instances: bool,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "memoryLimit")]
    pub memory_limit: u64,
    #[serde(rename = "customJavaPath", default)]
    pub custom_java_path: String,
    #[serde(rename = "customJavaArgs", default)]
    pub custom_java_args: String,
    #[serde(rename = "theme", default)]
    pub theme: String,
    #[serde(rename = "latestBranch")]
    pub latest_branch: Option<String>,
    #[serde(rename = "latestDevBranch")]
    pub latest_dev_branch: Option<String>,
    #[serde(
        rename = "concurrentDownloads",
        default = "default_concurrent_downloads"
    )]
    pub concurrent_downloads: i32,
    pub language: String,
    #[serde(rename = "configVersion")]
    pub config_version: String,
}

// use this to make settings migration possible. this involves some more stuff, ask tim for more info :)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OldLauncherOptions {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "experimentalMode")]
    pub experimental_mode: bool,
    #[serde(rename = "multipleInstances")]
    pub multiple_instances: bool,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "memoryPercentage")]
    pub memory_percentage: i32,
    #[serde(rename = "customJavaPath", default)]
    pub custom_java_path: String,
    #[serde(rename = "customJavaArgs", default)]
    pub custom_java_args: String,
    #[serde(rename = "theme", default)]
    pub theme: String,
    #[serde(rename = "latestBranch")]
    pub latest_branch: Option<String>,
    #[serde(rename = "latestDevBranch")]
    pub latest_dev_branch: Option<String>,
    #[serde(
        rename = "concurrentDownloads",
        default = "default_concurrent_downloads"
    )]
    pub concurrent_downloads: i32,
}

impl LauncherOptions {
    pub async fn load(app_data: &Path) -> Result<Self> {
        if !fs::try_exists(app_data.join("options.json"))
            .await
            .unwrap_or(false)
        {
            // if the file does not exist, create it with the default options
            info!("options.json does not exist, creating it with default options.");
            let options = LauncherOptions::default();
            options.store(app_data).await?;
            return Ok(options);
        }

        // load the options from the file
        let options = serde_json::from_slice::<LauncherOptions>(
            &fs::read(app_data.join("options.json")).await?,
        );
        if let Ok(options) = options {
            Ok(options)
        } else {
            info!("Failed to load options.json, trying to migrate old options.json");
            if let Ok(old_options) = serde_json::from_slice::<OldLauncherOptions>(
                &fs::read(app_data.join("options.json")).await?,
            ) {
                let default = LauncherOptions::default();
                let new_options = LauncherOptions {
                    keep_launcher_open: old_options.keep_launcher_open,
                    experimental_mode: old_options.experimental_mode,
                    multiple_instances: old_options.multiple_instances,
                    data_path: old_options.data_path,
                    memory_limit: default.memory_limit,
                    custom_java_path: old_options.custom_java_path,
                    custom_java_args: old_options.custom_java_args,
                    theme: old_options.theme,
                    latest_branch: old_options.latest_branch,
                    latest_dev_branch: old_options.latest_dev_branch,
                    concurrent_downloads: old_options.concurrent_downloads,
                    language: default.language,
                    config_version: default.config_version,
                };
                info!("Migrated old options.json to new options.json");
                new_options.store(app_data).await?;
                Ok(new_options)
            } else {
                info!("Failed to migrate old options.json, creating new options.json");
                let options = LauncherOptions::default();
                options.store(app_data).await?;
                Ok(options)
            }
        }
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        let _ = fs::write(
            app_data.join("options.json"),
            serde_json::to_string_pretty(&self)?,
        )
        .await
        .map_err(|err| -> String { format!("Failed to write options.json: {err}") });
        Ok(())
    }

    pub fn data_path_buf(&self) -> PathBuf {
        if self.data_path.is_empty() {
            return LAUNCHER_DIRECTORY.data_dir().to_path_buf();
        }
        PathBuf::from(&self.data_path)
    }
}

impl Default for LauncherOptions {
    fn default() -> Self {
        let mode = dark_light::detect();
        let theme = match mode {
            // Dark mode
            dark_light::Mode::Dark => "DARK",
            // Light mode & Unspecified
            dark_light::Mode::Light | dark_light::Mode::Default => "LIGHT",
        };
        Self {
            keep_launcher_open: true,
            experimental_mode: false,
            multiple_instances: false,
            data_path: LAUNCHER_DIRECTORY
                .data_dir()
                .to_str()
                .expect("Could not convert Path to str")
                .to_string(),
            memory_limit: 4 * 1024, // 4GB memory allocated to game
            custom_java_path: String::new(),
            custom_java_args: String::new(),
            theme: theme.to_string(),
            latest_branch: None,
            latest_dev_branch: None,
            concurrent_downloads: 20,
            language: String::from("en_US"),
            config_version: String::from("1.0"),
        }
    }
}

impl LauncherProfiles {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let launcher_profiles = serde_json::from_slice::<LauncherProfiles>(
            &fs::read(app_data.join("launcher_profiles.json")).await?,
        )
        .map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {err}") })
        .unwrap_or_else(|_| LauncherProfiles::default());
        Ok(launcher_profiles)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(
            app_data.join("launcher_profiles.json"),
            serde_json::to_string_pretty(&self)?,
        )
        .await
        .map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {err}") });
        Ok(())
    }

    pub async fn export(profile_id: String) -> Result<()> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let user_dirs = UserDirs::new().context("Could not get user directories")?;
        let downloads_dir = user_dirs
            .download_dir()
            .context("Could not get downloads directory")?;
        debug!("Downloads directory: {:?}", downloads_dir);
        let launcher_profiles = Self::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let profile = if options.experimental_mode {
            launcher_profiles
                .experimental_profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .context(format!("Profile with id {profile_id} not found"))?
        } else {
            launcher_profiles
                .main_profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .context(format!("Profile with id {profile_id} not found"))?
        };
        let mut export_profile = ExportProfile {
            id: profile.id.clone(),
            branch: profile.branch.clone(),
            name: profile.name.clone(),
            mods: profile.mods.clone(),
            addons: launcher_profiles
                .addons
                .iter()
                .find(|addons| addons.0 == &profile.branch)
                .map(|(_, addons)| addons.clone())
                .context("Could not find addons for profile")?,
        };

        // datapacks dont make sese since they are world specific
        export_profile.addons.datapacks.clear();

        let export_profile_json = serde_json::to_vec_pretty(&export_profile)?;
        let mut file = File::create(
            downloads_dir.join(format!("{}.noriskprofile", &profile.name.replace(' ', "_"))),
        )
        .await?;
        file.write_all(&export_profile_json).await?;

        Self::show_in_folder(
            downloads_dir
                .join(format!("{}.noriskprofile", &profile.name.replace(' ', "_")))
                .to_str()
                .context("Could not convert path to string")?,
        )?;

        Ok(())
    }

    pub async fn import(file_location: &str) -> Result<()> {
        let content = fs::read(file_location).await?;
        let import_profile: ExportProfile = serde_json::from_str(&String::from_utf8(content)?)?;

        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let mut launcher_profiles = Self::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();

        let mut new_profile = LauncherProfile {
            id: import_profile.id.clone(),
            branch: import_profile.branch.clone(),
            name: import_profile.name.clone(),
            mods: import_profile.mods.clone(),
        };

        if options.experimental_mode {
            // Check for branch missmatch -> this is done because branches can be fundementally incompatible
            if let Some(branch) = &options.latest_branch {
                if branch != &import_profile.branch {
                    anyhow::bail!("The profile you are trying to import is not compatible with your selected branch.");
                }
            }

            // Check for duplicate names -> append (imported) if necessary
            if launcher_profiles
                .experimental_profiles
                .iter()
                .any(|profile| profile.name == import_profile.name)
            {
                new_profile.name = format!("{} (imported)", new_profile.name);
            }

            // Check if profile already exists -> replace if id is matching
            if launcher_profiles
                .experimental_profiles
                .iter()
                .any(|profile| profile.id == import_profile.id)
            {
                launcher_profiles
                    .experimental_profiles
                    .iter_mut()
                    .find(|p| p.id == import_profile.id)
                    .context("Could not find profile to replace")?
                    .mods = import_profile.mods;
            } else {
                launcher_profiles.experimental_profiles.push(new_profile);
            }

            // Auto select new profile
            if let Some(selected_profile) = launcher_profiles
                .selected_experimental_profiles
                .get_mut(&import_profile.branch)
            {
                selected_profile.clone_from(&import_profile.id);
            }
        } else {
            // Check for branch missmatch -> this is done because branches can be fundementally incompatible
            if let Some(branch) = &options.latest_branch {
                if branch != &import_profile.branch {
                    anyhow::bail!("The profile you are trying to import is not compatible with your selected branch.");
                }
            }

            // Check for duplicate names -> append (imported) if necessary
            if launcher_profiles
                .main_profiles
                .iter()
                .any(|profile| profile.name == import_profile.name)
            {
                new_profile.name = format!("{} (imported)", new_profile.name);
            }

            // Check if profile already exists -> replace if id is matching
            if launcher_profiles
                .main_profiles
                .iter()
                .any(|profile| profile.id == import_profile.id)
            {
                launcher_profiles
                    .main_profiles
                    .iter_mut()
                    .find(|p| p.id == import_profile.id)
                    .context("Could not find profile to replace")?
                    .mods = import_profile.mods;
            } else {
                launcher_profiles.main_profiles.push(new_profile);
            }

            // Auto select new profile
            if let Some(selected_profile) = launcher_profiles
                .selected_main_profiles
                .get_mut(&import_profile.branch)
            {
                selected_profile.clone_from(&import_profile.id);
            }
        }

        let resourcepacks_to_add: Vec<_> = import_profile
            .addons
            .resourcepacks
            .iter()
            .filter(|resourcepack| {
                !launcher_profiles.addons[&import_profile.branch]
                    .resourcepacks
                    .iter()
                    .any(|pack| pack.slug == resourcepack.slug)
            })
            .cloned()
            .collect();

        if let Some(addons) = launcher_profiles.addons.get_mut(&import_profile.branch) {
            addons.resourcepacks.extend(resourcepacks_to_add);
        }

        let shaders_to_add: Vec<_> = import_profile
            .addons
            .shaders
            .iter()
            .filter(|shader| {
                !launcher_profiles.addons[&import_profile.branch]
                    .shaders
                    .iter()
                    .any(|shad| shad.slug == shader.slug)
            })
            .cloned()
            .collect();

        if let Some(addons) = launcher_profiles.addons.get_mut(&import_profile.branch) {
            addons.shaders.extend(shaders_to_add);
        }

        launcher_profiles
            .store(LAUNCHER_DIRECTORY.config_dir())
            .await?;

        Ok(())
    }

    pub fn show_in_folder(path: &str) -> anyhow::Result<()> {
        debug!("Spawning Path {}", path);
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .args(["/select,", path]) // The comma after select is not a typo
                .spawn()?;
            Ok(())
        }

        /* TODO Später
        #[cfg(target_os = "linux")]
        {

        }
        */

        #[cfg(target_os = "macos")]
        {
            Command::new("open").args(["-R", &path]).spawn()?;
            Ok(())
        }
    }
}

impl LastViewedPopups {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let last_viewed_popups = serde_json::from_slice::<LastViewedPopups>(
            &fs::read(app_data.join("last_viewed_popups.json")).await?,
        )
        .map_err(|err| -> String { format!("Failed to write last_viewed_popups.json: {err}") })
        .unwrap_or_default();
        Ok(last_viewed_popups)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(
            app_data.join("last_viewed_popups.json"),
            serde_json::to_string_pretty(&self)?,
        )
        .await
        .map_err(|err| -> String { format!("Failed to write last_viewed_popups.json: {err}") });
        Ok(())
    }
}

impl LatestRunningGame {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let latest_running_game = serde_json::from_slice::<LatestRunningGame>(
            &fs::read(app_data.join("latest_running_game.json")).await?,
        )
        .map_err(|err| -> String { format!("Failed to write latest_running_game.json: {err}") })
        .unwrap_or_default();
        Ok(latest_running_game)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(
            app_data.join("latest_running_game.json"),
            serde_json::to_string_pretty(&self)?,
        )
        .await
        .map_err(|err| -> String { format!("Failed to write latest_running_game.json: {err}") });
        Ok(())
    }
}
