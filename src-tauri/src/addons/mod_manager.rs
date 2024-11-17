use std::path::PathBuf;

use anyhow::Result;
use log::{debug, error};
use tokio::fs;

use crate::{app::{api::{ApiEndpoints, LoaderMod}, app_data::LauncherOptions, gui::FileData, modrinth_api::{CustomMod, Dependency, Mod, ModInfo, ModrinthApiEndpoints}}, error::{Error, ErrorKind}};

pub struct ModManager {}

impl ModManager {
    pub async fn get_mod_author(slug: &str) -> Result<String, Error> {
        let project_members = ModrinthApiEndpoints::get_project_members(&slug).await?;
        
        let mut author = "Unknown".to_string();
        project_members.iter().for_each(|member| {
            if member.role.to_uppercase() == "OWNER" {
                author = member.user.username.clone();
            }
        });

        Ok(author)
    }

    pub async fn get_featured_mods(branch: &str, mc_version: &str) -> Result<Vec<ModInfo>, Error> {
        let featured = ApiEndpoints::norisk_featured_mods(&branch).await?;
        // fetch mod info for each mod
        let mut mod_infos: Vec<ModInfo> = Vec::new();
        for mod_id in featured {
            let project_members = ModrinthApiEndpoints::get_project_members(&mod_id).await?;
            let mut mod_info = ModrinthApiEndpoints::get_project::<ModInfo>(&*mod_id).await?;
            // Filter featured mods based on mc version
            match &mod_info.game_versions {
                Some(versions) => {
                    if versions.contains(&mc_version.to_string()) {
                        project_members.iter().for_each(|member| {
                            if member.role.to_uppercase() == "OWNER" {
                                mod_info.author = Some(member.user.username.clone());
                            }
                        });

                        mod_infos.push(mod_info);
                    } else {
                        debug!(
                            "Featured mod {} does not support version {}",
                            mod_info.title, mc_version
                        );
                    }
                }
                _ => {
                    error!("Featured mod {} has no game versions", mod_info.title);
                }
            }
        }
        Ok(mod_infos)
    }

    async fn get_dependencies(dependencies: &Vec<Dependency>, params: &str, required_mods: &Vec<LoaderMod>) -> Result<Vec<CustomMod>, Error> {
        let mut result = Vec::new();

        for dependency in dependencies {
            if dependency.dependency_type == "required" {
                let dependency_mods = ModrinthApiEndpoints::get_project_version(&dependency.project_id, params).await?;
                if let Some(dependency) = dependency_mods.first() {
                    let dependency_mod = ModrinthApiEndpoints::get_project::<Mod>(&dependency.project_id).await?;
                    let already_required_by_nrc = dependency.is_already_required_by_norisk_client(required_mods);
                    result.push(dependency.to_custom_mod(&dependency_mod.title, &dependency_mod.slug, &dependency_mod.icon_url, Vec::new(), false, if already_required_by_nrc { false } else { true }));
                }
            }
        }

        Ok(result)
    }

    pub async fn install_mod_and_dependencies(slug: &str, version: Option<&str>, params: &str, required_mods: &Vec<LoaderMod>) -> Result<CustomMod, Error> {
        let mod_project = ModrinthApiEndpoints::get_project::<Mod>(slug).await?;
        let mod_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project = if version.is_some() {
            mod_versions.iter().find(|project| project.version_number == version.unwrap()).ok_or(Error::from(ErrorKind::OtherError("Mod not found".to_string())))?
        } else {
            mod_versions.first().ok_or(Error::from(ErrorKind::OtherError("Mod not found".to_string())))?
        };
        let dependencies = Self::get_dependencies(&project.dependencies, params, required_mods).await?;

        Ok(CustomMod {
            title: mod_project.title.clone(),
            image_url: "".to_string(), //Ich setze das einfach in Tauri kein bock
            value: project.to_loader_mod(slug, false, true),
            dependencies,
        })
    }

    pub fn get_custom_mods_folder(options: LauncherOptions, profile_id: &str) -> PathBuf {
        options
            .data_path_buf()
            .join("mod_cache")
            .join("CUSTOM")
            .join(&profile_id)
    }

    pub async fn get_custom_mods_filenames(options: LauncherOptions, profile_id: &str) -> Result<Vec<String>, Error> {
        let custom_mods_folder = Self::get_custom_mods_folder(options, profile_id);
        
        fs::create_dir_all(&custom_mods_folder).await?;

        let mut mods_read = tokio::fs::read_dir(&custom_mods_folder).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = mods_read.next_entry().await? {
            if entry.file_type().await?.is_file() {
                files.push(entry.file_name().to_str().unwrap().to_string());
            }
        }

        Ok(files)
    }

    pub async fn save_custom_mod_to_folder(options: LauncherOptions, profile_id: &str, file: FileData) -> Result<(), Error> {
        let file_path = Self::get_custom_mods_folder(options, profile_id).join(&file.name);

        fs::create_dir_all(&file_path.parent().unwrap()).await?;
        fs::copy(PathBuf::from(file.location), &file_path).await?;

        Ok(())
    }

    pub async  fn delete_custom_mod_file(options: LauncherOptions, profile_id: &str, file_name: &str) -> Result<(), Error> {
        let file_path = Self::get_custom_mods_folder(options, profile_id).join(file_name);
        if file_path.exists() {
            fs::remove_file(&file_path).await?;
        }

        Ok(())
    }
}