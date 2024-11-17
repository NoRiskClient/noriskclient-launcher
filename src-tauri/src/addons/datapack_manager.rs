use std::path::PathBuf;

use anyhow::Result;
use log::{debug, error, info};
use tauri::Window;
use tokio::fs;

use crate::{addons::progress::AddonsProgress, app::{api::ApiEndpoints, app_data::LauncherOptions, gui::FileData, modrinth_api::{Datapack, DatapackInfo, ModrinthApiEndpoints}}, error::{Error, ErrorKind}, utils::download_file};

pub struct DataPackManager {}

impl DataPackManager {
    pub async fn get_datapack(slug: &str, params: &str, world: &str) -> Result<Datapack, Error> {
        let datapack_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = datapack_versions.first().ok_or(Error::from(ErrorKind::OtherError("Datapack not found".to_string())))?;
        let project = ModrinthApiEndpoints::get_project::<DatapackInfo>(&slug).await?;

        Ok(Datapack {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            world_name: world.to_string(),
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
    }

    pub async fn get_featured_datapacks(branch: &str, mc_version: &str) -> Result<Vec<DatapackInfo>, Error> {
        let featured = ApiEndpoints::norisk_featured_datapacks(&branch).await?;
        // fetch datapack info for each datapack
        let mut datapack_infos: Vec<DatapackInfo> = Vec::new();
        for datapack_id in featured {
            let project_members = ModrinthApiEndpoints::get_project_members(&datapack_id).await?;
            let mut datapack_info = ModrinthApiEndpoints::get_project::<DatapackInfo>(&*datapack_id).await?;
            // Filter featured datapacks based on mc version
            match &datapack_info.game_versions {
                Some(versions) => {
                    if versions.contains(&mc_version.to_string()) {
                        project_members.iter().for_each(|member| {
                            if member.role.to_uppercase() == "OWNER" {
                                datapack_info.author =
                                    Some(member.user.username.clone());
                            }
                        });
                        datapack_infos.push(datapack_info);
                    } else {
                        debug!(
                            "Featured datapack {} does not support version {}",
                            datapack_info.title, mc_version
                        );
                    }
                }
                _ => {
                    error!(
                        "Featured datapack {} has no game versions",
                        datapack_info.title
                    );
                }
            }
        }

        Ok(datapack_infos)
    }

    pub fn get_datapack_folder(options: LauncherOptions, branch: &str, world: &str) -> PathBuf {
        options
            .data_path_buf()
            .join("gameDir")
            .join(branch)
            .join("saves")
            .join(world)
            .join("datapacks")
    }

    pub async fn download_datapack(options: LauncherOptions, branch: &str, world: &str, datapack: &Datapack, window: Window) -> Result<(), Error> {
        let datapack_path = Self::get_datapack_folder(options, branch, world).join(&datapack.file_name);
    
        // Do we need to download the DataPack?
        if !datapack_path.exists() || datapack_path.is_dir() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&datapack_path.parent().unwrap()).await?;
    
            // ignore shaders that dont have a download url.
            if let Some(url) = &datapack.url {
                info!("Downloading datapack {} from {}", &datapack.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    window.emit("addons-progress", AddonsProgress { identifier: datapack.slug.clone(), current: a, max: b }).unwrap();
                }).await?;
                
                fs::write(&datapack_path, retrieved_bytes).await?;
                info!("Installed Datapack {} in world {}", &datapack.file_name, &datapack.world_name);
            }
        }
    
        Ok(())
    }

    pub async fn get_worlds(options: LauncherOptions, branch: &str) -> Result<Vec<String>, Error> {
        let mut world_folders: Vec<String> = Vec::new();
        let world_folder = options
            .data_path_buf()
            .join("gameDir")
            .join(&branch)
            .join("saves");

        if world_folder.exists() {
            let mut entries = fs::read_dir(world_folder).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    world_folders.push(path.file_name().unwrap().to_str().unwrap().to_string());
                }
            }
        }
        Ok(world_folders)
    }

    pub async fn get_custom_datapack_filenames(options: LauncherOptions, branch: &str, world: &str, installed_datapacks: Vec<Datapack>) -> Result<Vec<String>, Error> {
        let datapacks_folder = Self::get_datapack_folder(options, branch, world);

        fs::create_dir_all(&datapacks_folder).await?;

        let mut datapacks_read = tokio::fs::read_dir(&datapacks_folder).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = datapacks_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_datapacks.iter().any(|datapack| datapack.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn save_custom_datapack_to_folder(options: LauncherOptions, branch: &str, world: &str, file: FileData) -> Result<(), Error> {
        let datapack_path = Self::get_datapack_folder(options, branch, world).join(&file.name);

        fs::copy(PathBuf::from(file.location), &datapack_path).await?;
        
        Ok(())
    }

    pub async fn delete_datapack_file(options: LauncherOptions, branch: &str, world: &str, file_name: &str) -> Result<(), Error> {
        let datapack_path = Self::get_datapack_folder(options, branch, world).join(file_name);
        if datapack_path.exists() {
            fs::remove_file(datapack_path).await?;
        }

        Ok(())
    }
}