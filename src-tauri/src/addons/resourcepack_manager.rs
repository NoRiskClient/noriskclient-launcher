use std::path::PathBuf;

use anyhow::Result;
use log::{debug, error, info};
use tauri::Window;
use tokio::fs;

use crate::{addons::progress::AddonsProgress, app::{api::ApiEndpoints, app_data::LauncherOptions, gui::FileData, modrinth_api::{ModrinthApiEndpoints, ResourcePack, ResourcePackInfo}}, error::{Error, ErrorKind}, utils::download_file};

pub struct ResourcePackManager {}

impl ResourcePackManager {
    pub async fn get_resourcepack(slug: &str, params: &str) -> Result<ResourcePack, Error> {
        let resourcepack_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = resourcepack_versions.first().ok_or(Error::from(ErrorKind::OtherError("Mod not found".to_string())))?;
        let project = ModrinthApiEndpoints::get_project::<ResourcePackInfo>(&slug).await?;

        Ok(ResourcePack {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
    }

    pub async fn get_featured_resourcepacks(branch: &str, mc_version: &str) -> Result<Vec<ResourcePackInfo>, Error> {
        let featured =  ApiEndpoints::norisk_featured_resourcepacks(&branch).await?;
        // fetch resourcepack info for each resourcepack
        let mut resourcepack_infos: Vec<ResourcePackInfo> = Vec::new();
        for resourcepack_id in featured {
            let project_members = ModrinthApiEndpoints::get_project_members(&resourcepack_id).await?;
            let mut resourcepack_info = ModrinthApiEndpoints::get_project::<ResourcePackInfo>(&*resourcepack_id).await?;
            // Filter featured resourcepacks based on mc version
            match &resourcepack_info.game_versions {
                Some(versions) => {
                    if versions.contains(&mc_version.to_string()) {
                        project_members.iter().for_each(|member| {
                            if member.role.to_uppercase() == "OWNER" {
                                resourcepack_info.author =
                                    Some(member.user.username.clone());
                            }
                        });
                        resourcepack_infos.push(resourcepack_info);
                    } else {
                        debug!(
                            "Featured resourcepack {} does not support version {}",
                            resourcepack_info.title, mc_version
                        );
                    }
                }
                _ => {
                    error!(
                        "Featured resourcepack {} has no game versions",
                        resourcepack_info.title
                    );
                }
            }
        }
        
        Ok(resourcepack_infos)
    }

    pub fn get_resourcepack_folder(options: LauncherOptions, branch: &str) -> PathBuf {
        options
            .data_path_buf()
            .join("gameDir")
            .join(branch)
            .join("resourcepacks")
    }

    pub async fn download_resourcepack(options: LauncherOptions, branch: &str, resourcepack: &ResourcePack, window: Window) -> Result<(), Error> {
        let resourcepack_path = Self::get_resourcepack_folder(options, branch).join(&resourcepack.file_name);
    
        // Do we need to download the ResourcePack?
        if !resourcepack_path.exists() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&resourcepack_path.parent().unwrap()).await?;
    
            // ignore shaders that dont have a download url.
            if let Some(url) = &resourcepack.url {
                info!("Downloading resourcepack {} from {}", &resourcepack.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    window.emit("addons-progress", AddonsProgress { identifier: resourcepack.slug.clone(), current: a, max: b }).unwrap();
                }).await?;
                
                fs::write(&resourcepack_path, retrieved_bytes).await?;
                info!("Installed ResourcePack {}", &resourcepack.file_name);
            }
        }
    
        Ok(())
    }

    pub async fn get_custom_resourcepack_filenames(options: LauncherOptions, branch: &str, installed_resourcepacks: Vec<ResourcePack>) -> Result<Vec<String>, Error> {
        let resourcepack_folder = Self::get_resourcepack_folder(options, branch);
        
        fs::create_dir_all(&resourcepack_folder).await?;

        let mut resourcepacks_read = tokio::fs::read_dir(&resourcepack_folder).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = resourcepacks_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_resourcepacks.iter().any(|resourcepack| resourcepack.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn save_custom_resourcepack_to_folder(options: LauncherOptions, branch: &str, file: FileData) -> Result<(), Error> {
        let file_path = Self::get_resourcepack_folder(options, branch).join(&file.name);

        fs::create_dir_all(&file_path.parent().unwrap()).await?;
        fs::copy(PathBuf::from(file.location), file_path).await?;

        Ok(())
    }

    pub async fn delete_resourcepack_file(options: LauncherOptions, branch: &str, file_name: &str) -> Result<(), Error> {
        let file_path = Self::get_resourcepack_folder(options, branch).join(file_name);
        if file_path.exists() {
            fs::remove_file(&file_path).await?;
        }

        Ok(())
    }
}