use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::vec;

use anyhow::Result;
use directories::UserDirs;
use log::debug;
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LastViewedPopups {
    pub changelog: String,
    pub announcements: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LatestRunningGame {
    pub id: Option<u32>
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
    #[serde(rename = "concurrentDownloads", default = "default_concurrent_downloads")]
    pub concurrent_downloads: i32,
}

impl LauncherOptions {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the options from the file
        let options = serde_json::from_slice::<LauncherOptions>(&fs::read(app_data.join("options.json")).await?).map_err(|err| -> String { format!("Failed to write options.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherOptions::default());
        Ok(options)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        let _ = fs::write(app_data.join("options.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write options.json: {}", err).into() });
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
            // Light mode
            dark_light::Mode::Light => "LIGHT",
            // Unspecified
            dark_light::Mode::Default => "LIGHT",
        };
        Self {
            keep_launcher_open: true,
            experimental_mode: false,
            multiple_instances: false,
            data_path: LAUNCHER_DIRECTORY.data_dir().to_str().unwrap().to_string(),
            memory_percentage: 35, // 35% memory of computer allocated to game
            custom_java_path: String::new(),
            custom_java_args: String::new(),
            theme: theme.to_string(),
            latest_branch: None,
            latest_dev_branch: None,
            concurrent_downloads: 10,
        }
    }
}

impl LauncherProfiles {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let launcher_profiles = serde_json::from_slice::<LauncherProfiles>(&fs::read(app_data.join("launcher_profiles.json")).await?).map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherProfiles::default());
        Ok(launcher_profiles)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(app_data.join("launcher_profiles.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {}", err).into() });
        Ok(())
    }

    pub async fn export(profile_id: String) -> Result<(), String> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let user_dirs = UserDirs::new().unwrap();
        let downloads_dir = user_dirs.download_dir().unwrap();
        debug!("Downloads directory: {:?}", downloads_dir);
        let launcher_profiles = Self::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let profile = if options.experimental_mode {
            launcher_profiles
                .experimental_profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .ok_or_else(|| format!("Profile with id {} not found", profile_id))?
        } else {
            launcher_profiles
                .main_profiles
                .iter()
                .find(|profile| profile.id == profile_id)
                .ok_or_else(|| format!("Profile with id {} not found", profile_id))?
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
                .unwrap(),
        };
    
        // datapacks dont make sese since they are world specific
        export_profile.addons.datapacks.clear();
    
        let export_profile_json = serde_json::to_vec_pretty(&export_profile)
            .map_err(|e| format!("Error serializing profile: {:?}", e))?;
        let mut file = File::create(downloads_dir.join(format!("{}.noriskprofile", &profile.name.replace(" ", "_")))).await
            .map_err(|e| format!("Error creating file: {:?}", e))?;
        file.write_all(&export_profile_json).await
            .map_err(|e| format!("Error writing file: {:?}", e))?;

        Self::show_in_folder(downloads_dir.join(format!("{}.noriskprofile", &profile.name.replace(" ", "_"))).to_str().unwrap());
    
        Ok(())
    }

    pub async fn import(file_location: &str) -> Result<(), String> {
        let content = fs::read(file_location)
            .await
            .map_err(|e| format!("Error reading file: {:?}", e))?;
        let import_profile: ExportProfile = serde_json::from_str(
            &String::from_utf8(content)
                .map_err(|e| format!("Error converting content to string: {:?}", e))?,
        )
        .map_err(|e| format!("Error deserializing profile: {:?}", e))?;
    
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
            if options.latest_dev_branch.is_some() && &options.latest_dev_branch.unwrap() != &import_profile.branch {
                return Err("The profile you are trying to import is not compatible with your selected branch.".to_string())
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
                .any(|profile| &profile.id == &import_profile.id)
            {
                launcher_profiles.experimental_profiles.iter_mut().find(|p| p.id == import_profile.id).unwrap().mods = import_profile.mods;
            } else {
                launcher_profiles.experimental_profiles.push(new_profile);
            }

            // Auto select new profile
            launcher_profiles.selected_experimental_profiles.get_mut(&import_profile.branch).map(|selected_profile| *selected_profile = import_profile.id.clone());
        } else {
            // Check for branch missmatch -> this is done because branches can be fundementally incompatible
            if options.latest_branch.is_some() && &options.latest_branch.unwrap() != &import_profile.branch {
                return Err("The profile you are trying to import is not compatible with your selected branch.".to_string())
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
                .any(|profile| &profile.id == &import_profile.id)
            {
                launcher_profiles.main_profiles.iter_mut().find(|p| p.id == import_profile.id).unwrap().mods = import_profile.mods;
            } else {
                launcher_profiles.main_profiles.push(new_profile);
            }

            // Auto select new profile
            launcher_profiles.selected_main_profiles.get_mut(&import_profile.branch).map(|selected_profile| *selected_profile = import_profile.id.clone());
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
            .await
            .map_err(|e| format!("Error storing profiles: {:?}", e))?;

        Ok(())
    }

    pub fn show_in_folder(path: &str) {
        debug!("Spawning Path {}",path);
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .args(["/select,", &path]) // The comma after select is not a typo
                .spawn()
                .unwrap();
        }

        /* TODO Später
        #[cfg(target_os = "linux")]
        {
            
        }
        */

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .args(["-R", &path])
                .spawn()
                .unwrap();
        }
    }
}

impl Default for LauncherProfiles {
    fn default() -> Self {
        Self {
            main_profiles: vec![],
            selected_main_profiles: HashMap::new(),
            experimental_profiles: vec![],
            selected_experimental_profiles: HashMap::new(),
            addons: HashMap::new(),
        }
    }
}

impl Default for Addons {
    fn default() -> Self {
        Self {
            shaders: vec![],
            resourcepacks: vec![],
            datapacks: vec![],
        }
    }
}

impl Default for LastViewedPopups {
    fn default() -> Self {
        Self {
            changelog: String::new(),
            announcements: vec![],
        }
    }
}

impl LastViewedPopups {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let last_viewed_popups = serde_json::from_slice::<LastViewedPopups>(&fs::read(app_data.join("last_viewed_popups.json")).await?).map_err(|err| -> String { format!("Failed to write last_viewed_popups.json: {}", err.to_string()).into() }).unwrap_or_default();
        Ok(last_viewed_popups)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(app_data.join("last_viewed_popups.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write last_viewed_popups.json: {}", err).into() });
        Ok(())
    }
}

impl Default for LatestRunningGame {
    fn default() -> Self {
        Self {
            id: None
        }
    }
}

impl LatestRunningGame {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let latest_running_game = serde_json::from_slice::<LatestRunningGame>(&fs::read(app_data.join("latest_running_game.json")).await?).map_err(|err| -> String { format!("Failed to write latest_running_game.json: {}", err.to_string()).into() }).unwrap_or_default();
        Ok(latest_running_game)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(app_data.join("latest_running_game.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write latest_running_game.json: {}", err).into() });
        Ok(())
    }
}
