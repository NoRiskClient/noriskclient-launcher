use std::path::PathBuf;
use anyhow::Result;
use log::{error, info};
use tauri::Window;
use tokio::fs;

use crate::{addons::progress::AddonsProgress, app::{api::ApiEndpoints, app_data::LauncherOptions, gui::FileData, modrinth_api::{ModrinthApiEndpoints, Shader, ShaderInfo}}, error::{Error, ErrorKind}, utils::download_file};

pub struct ShaderManager;

impl ShaderManager {
    pub async fn get_shader(slug: &str, params: &str) -> Result<Shader, Error> {
        let shader_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = shader_versions.first().ok_or(Error::from(ErrorKind::OtherError("No project version found".to_string())))?;
        let project = ModrinthApiEndpoints::get_project::<ShaderInfo>(&slug).await?;

        Ok(Shader {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
    }

    pub async fn get_featured_shaders(branch: &str, mc_version: &str) -> Result<Vec<ShaderInfo>, Error> {
        let featured = ApiEndpoints::norisk_featured_shaders(&branch).await?;
        // fetch shader info for each resourcepack
        let mut shader_infos: Vec<ShaderInfo> = Vec::new();
        for shader_id in featured {
            let project_members = ModrinthApiEndpoints::get_project_members(&shader_id).await?;
            let mut shader_info = ModrinthApiEndpoints::get_project::<ShaderInfo>(&*shader_id).await?; {
            // Filter featured shaders based on mc version
            match &shader_info.game_versions {
                Some(versions) => {
                    if versions.contains(&mc_version.to_string()) {
                        project_members.iter().for_each(|member| {
                            if member.role.to_uppercase() == "OWNER" {
                                shader_info.author = Some(member.user.username.clone());
                            }
                        });
                        shader_infos.push(shader_info);
                    } else {
                        error!(
                            "Featured shader {} does not support version {}",
                            shader_info.title, mc_version
                        );
                    }
                }
                _ => {
                    error!(
                        "Featured shader {} has no game versions",
                        shader_info.title
                    );
                }
            }
            }
        }
        Ok(shader_infos)
    }

    pub fn get_shaders_folder(options: LauncherOptions, branch: &str) -> PathBuf {
        options
            .data_path_buf()
            .join("gameDir")
            .join(branch)
            .join("shaderpacks")
    }

    pub async fn get_custom_shaders_filenames(options: LauncherOptions, branch: &str, installed_shaders: Vec<Shader>) -> Result<Vec<String>, Error> {
        let shaders_folder = Self::get_shaders_folder(options, branch);
    
        fs::create_dir_all(&shaders_folder).await?;

        let mut shaders_read = fs::read_dir(&shaders_folder).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = shaders_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_shaders.iter().any(|shader| shader.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn download_shader(options: LauncherOptions, branch: &str, shader: &Shader, window: Window) -> Result<(), Error> {
        let shader_path = Self::get_shaders_folder(options, branch).join(&shader.file_name);
    
        // Do we need to download the shader?
        if !shader_path.exists() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&shader_path.parent().unwrap()).await?;
            
            // ignore shaders that dont have a download url.
            if let Some(url) = &shader.url {
                info!("Downloading shader {} from {}", &shader.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    window.emit("addons-progress", AddonsProgress { identifier: shader.slug.clone(), current: a, max: b }).unwrap();
                }).await?;
                
                fs::write(&shader_path, retrieved_bytes).await?;
                info!("Installed Shader {}", &shader.file_name);
            }
        }
    
        Ok(())
    }

    pub async fn save_custom_shader_to_folder(options: LauncherOptions, branch: &str, file: FileData) -> Result<(), Error> {
        let file_path = Self::get_shaders_folder(options, branch).join(&file.name);

        fs::create_dir_all(&file_path.parent().unwrap()).await?;
        fs::copy(PathBuf::from(file.location), &file_path).await?;

        Ok(())
    }

    pub async fn delete_shader_file(options: LauncherOptions, branch: &str, file_name: &str) -> Result<(), Error> {
        let shaders_folder = Self::get_shaders_folder(options, branch);
        let file = shaders_folder.join(file_name);
        let settings_file = shaders_folder.join(format!("{}.txt", file_name));

        if file.exists() {
            fs::remove_file(&file).await?;
            info!("Deleted {} from {} shaders folder.", file_name, branch);
        }
        if settings_file.exists() {
            fs::remove_file(&settings_file).await?;
            info!("Deleted {}.txt from {} shaders folder.", file_name, branch);
        }

        Ok(())
    }
}
