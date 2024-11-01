use std::path::Path;
use std::sync::{Mutex, Arc};

use anyhow::{Ok, Result};
use log::{debug, info};
use tokio::fs;

use crate::app::api::{LoaderSubsystem, ModSource, LoaderMod, NoRiskLaunchManifest};
use crate::app::modrinth_api::{Datapack, ResourcePack, Shader};
use crate::error::LauncherError;
use crate::minecraft::launcher;
use crate::minecraft::launcher::{LauncherData, LaunchingParameter};
use crate::minecraft::progress::{get_max, get_progress, ProgressReceiver, ProgressUpdate, ProgressUpdateSteps};
use crate::minecraft::version::{VersionManifest, VersionProfile};
use crate::utils::{download_file, get_maven_artifact_path};

///
/// Prelaunching client
///
pub(crate) async fn launch<D: Send + Sync>(norisk_token: &str, uuid: &str, launch_manifest: NoRiskLaunchManifest, launching_parameter: LaunchingParameter, additional_mods: Vec<LoaderMod>, shaders: Vec<Shader>, resourcepacks: Vec<ResourcePack>, datapacks: Vec<Datapack>, progress: LauncherData<D>, window: Arc<Mutex<tauri::Window>>) -> Result<()> {
    info!("Loading minecraft version manifest...");
    let mc_version_manifest = VersionManifest::download().await?;

    let build = &launch_manifest.build;
    let subsystem = &launch_manifest.subsystem;

    progress.progress_update(ProgressUpdate::set_max());
    progress.progress_update(ProgressUpdate::SetProgress(0));

    let data_directory = launching_parameter.data_path.clone();

    // Copy retrieve and copy mods from manifest
    clear_mods(&data_directory, &launch_manifest).await?;
    retrieve_and_copy_mods(&data_directory, &launch_manifest, &launch_manifest.mods, &additional_mods, &progress).await?;
    retrieve_and_copy_mods(&data_directory, &launch_manifest, &additional_mods, &additional_mods, &progress).await?;
    retrieve_shaders(&data_directory, &launch_manifest, &shaders, &progress).await?;
    retrieve_resourcepacks(&data_directory, &launch_manifest, &resourcepacks, &progress).await?;
    retrieve_datapacks(&data_directory, &launch_manifest, &datapacks, &progress).await?;

    info!("Loading version profile...");
    let manifest_url = match subsystem {
        LoaderSubsystem::Fabric { manifest, .. } => manifest
            .replace("{MINECRAFT_VERSION}", &build.mc_version)
            .replace("{FABRIC_LOADER_VERSION}", &build.fabric_loader_version),
        LoaderSubsystem::Forge { manifest, .. } => manifest.clone()
    };
    let mut version = VersionProfile::load(&manifest_url).await?;

    if let Some(inherited_version) = &version.inherits_from {
        let url = mc_version_manifest.versions
            .iter()
            .find(|x| &x.id == inherited_version)
            .map(|x| &x.url)
            .ok_or_else(|| LauncherError::InvalidVersionProfile(format!("unable to find inherited version manifest {}", inherited_version)))?;

        debug!("Determined {}'s download url to be {}", inherited_version, url);
        info!("Downloading inherited version {}...", inherited_version);

        let parent_version = VersionProfile::load(url).await?;

        version.merge(parent_version)?;
    }

    info!("Launching {}...", launch_manifest.build.branch);

    launcher::launch(norisk_token, uuid, &data_directory, launch_manifest, version, launching_parameter, progress, window).await?;
    Ok(())
}

pub(crate) async fn clear_mods(data: &Path, manifest: &NoRiskLaunchManifest) -> Result<()> {
    let mods_path = data.join("gameDir").join(&manifest.build.branch).join("mods");

    if !mods_path.exists() {
        return Ok(());
    }

    // Clear mods directory
    let mut mods_read = fs::read_dir(&mods_path).await?;
    while let Some(entry) = mods_read.next_entry().await? {
        if entry.file_type().await?.is_file() {
            fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

pub async fn retrieve_and_copy_mods(data: &Path, manifest: &NoRiskLaunchManifest, mods: &Vec<LoaderMod>, additional_mods: &Vec<LoaderMod>, progress: &impl ProgressReceiver) -> Result<()> {
    let mod_cache_path = data.join("mod_cache");
    let mods_path = data.join("gameDir").join(&manifest.build.branch).join("mods");

    fs::create_dir_all(&mod_cache_path).await?;
    fs::create_dir_all(&mods_path).await?;

    let mut installed_mods: Vec<LoaderMod> = Vec::new();

    // Download and copy mods
    let max = get_max(mods.len());

    for (mod_idx, current_mod) in mods.iter().enumerate() {
        // Skip mods that are not needed
        if (!current_mod.required && !current_mod.enabled) || additional_mods.iter().any(|m| m.source.get_slug() == current_mod.source.get_slug() && m.source.get_repository() == "PLACEHOLDER") {
            continue;
        }

        if installed_mods.iter().any(|loader_mod| {
            return loader_mod.is_same_slug(current_mod);
        }) {
            let already_installed = installed_mods.iter().find(|&loader_mod| {
                return loader_mod.is_same_slug(current_mod);
            }).unwrap();
            info!("Skipping Mod {:?} cuz {:?} is already installed",current_mod,already_installed);
            continue;
        }

        progress.progress_update(ProgressUpdate::set_label(format!("Downloading recommended mod {}", current_mod.name)));

        let current_mod_path = mod_cache_path.join(current_mod.source.get_path()?);

        // Do we need to download the mod?
        if !current_mod_path.exists() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&current_mod_path.parent().unwrap()).await?;

            match &current_mod.source {
                ModSource::Repository { repository, artifact, url } => {
                    let download_url = if let Some(url) = url.clone() {
                        url
                    } else {
                        let repository_url = manifest.repositories.get(repository).ok_or_else(|| LauncherError::InvalidVersionProfile(format!("There is no repository specified with the name {}", repository)))?;
                        let maven_artifact_path = get_maven_artifact_path(artifact)?;
                        format!("{}{}", repository_url, maven_artifact_path)
                    };

                    info!("downloading mod {} from {}", artifact, download_url);

                    let retrieved_bytes = download_file(&download_url, |a, b| {
                        progress.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskClientMods, get_progress(mod_idx, a, b), max));
                    }).await?;

                    fs::write(&current_mod_path, retrieved_bytes).await?;
                }
            }
        }

        // Copy the mod.
        fs::copy(&current_mod_path, mods_path.join(format!("{}.jar", current_mod.name.replace(".jar","")))).await?;

        info!("Installed Mod {:?}",current_mod);
        installed_mods.push(current_mod.clone())
    }

    Ok(())
}

pub async fn retrieve_shaders(data: &Path, manifest: &NoRiskLaunchManifest, shaders: &Vec<Shader>, progress: &impl ProgressReceiver) -> Result<()> {
    let shader_path = data.join("gameDir").join(&manifest.build.branch).join("shaderpacks");

    fs::create_dir_all(&shader_path).await?;

    let mut installed_shaders: Vec<Shader> = Vec::new();

    // Download shaders
    let mut max = get_max(shaders.len());

    for (shader_idx, current_shader) in shaders.iter().enumerate() {
        if installed_shaders.iter().any(|shader| {
            return shader.slug == current_shader.slug;
        }) {
            let already_installed = installed_shaders.iter().find(|&shader| {
                return shader.slug == current_shader.slug;
            }).unwrap();
            println!("Skipping Shader {:?} cuz {:?} is already installed", &current_shader, already_installed);
            max -= 100;
            continue;
        }

        progress.progress_update(ProgressUpdate::set_label(format!("Downloading shader {}", &current_shader.title)));

        let current_shader_path = shader_path.join(&current_shader.file_name);

        // Do we need to download the shader?
        if !current_shader_path.exists() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&current_shader_path.parent().unwrap()).await?;

            // ignore shaders that dont have a download url.
            if let Some(url) = &current_shader.url {
                info!("downloading shader {} from {}", &current_shader.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    progress.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadShader, get_progress(shader_idx, a, b), max));
                }).await?;
                
                fs::write(&current_shader_path, retrieved_bytes).await?;
                info!("Installed Shader {}", &current_shader.file_name);
            }
        } else {
            println!("Shader {} is already downloaded", &current_shader.file_name);
            max -= 100;
        }

        installed_shaders.push(current_shader.clone())
    }

    Ok(())
}

pub async fn retrieve_resourcepacks(data: &Path, manifest: &NoRiskLaunchManifest, resourcepacks: &Vec<ResourcePack>, progress: &impl ProgressReceiver) -> Result<()> {
    let resourcepack_path = data.join("gameDir").join(&manifest.build.branch).join("resourcepacks");

    fs::create_dir_all(&resourcepack_path).await?;

    let mut installed_resourcepacks: Vec<ResourcePack> = Vec::new();

    // Download shaders
    let max = get_max(resourcepacks.len());

    for (resourcepack_idx, current_resourcepack) in resourcepacks.iter().enumerate() {
        if installed_resourcepacks.iter().any(|resourcepack| {
            return resourcepack.slug == current_resourcepack.slug;
        }) {
            let already_installed = installed_resourcepacks.iter().find(|&resourcepack| {
                return resourcepack.slug == current_resourcepack.slug;
            }).unwrap();
            info!("Skipping ResoucePack {:?} cuz {:?} is already installed", &current_resourcepack, already_installed);
            continue;
        }

        progress.progress_update(ProgressUpdate::set_label(format!("Downloading resourcepack {}", &current_resourcepack.title)));

        let current_resourcepack_path = resourcepack_path.join(&current_resourcepack.file_name);

        // Do we need to download the ResourcePack?
        if !current_resourcepack_path.exists() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&current_resourcepack_path.parent().unwrap()).await?;

            // ignore shaders that dont have a download url.
            if let Some(url) = &current_resourcepack.url {
                info!("downloading resourcepack {} from {}", &current_resourcepack.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    progress.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadResourcePack, get_progress(resourcepack_idx, a, b), max));
                }).await?;
                
                fs::write(&current_resourcepack_path, retrieved_bytes).await?;
                info!("Installed ResourcePack {}", &current_resourcepack.file_name);
            }
        } else {
            info!("ResourcePack {} is already downloaded", &current_resourcepack.file_name);
        }

        installed_resourcepacks.push(current_resourcepack.clone())
    }

    Ok(())
}

pub async fn retrieve_datapacks(data: &Path, manifest: &NoRiskLaunchManifest, datapacks: &Vec<Datapack>, progress: &impl ProgressReceiver) -> Result<()> {
    let saves_path = data.join("gameDir").join(&manifest.build.branch).join("saves");

    fs::create_dir_all(&saves_path).await?;
    
    let mut installed_datapacks: Vec<Datapack> = Vec::new();
    
    // Download shaders
    let max = get_max(datapacks.len());
    
    for (datapack_idx, current_datapack) in datapacks.iter().enumerate() {
        let datapack_path = saves_path.join(current_datapack.world_name.clone()).join("datapacks");

        fs::create_dir_all(&datapack_path).await?;
        if installed_datapacks.iter().any(|datapack| {
            return datapack.slug == current_datapack.slug && current_datapack.world_name == datapack.world_name;
        }) {
            let already_installed = installed_datapacks.iter().find(|&datapack| {
                return datapack.slug == current_datapack.slug && current_datapack.world_name == datapack.world_name;
            }).unwrap();
            info!("Skipping Datapack {:?} cuz {:?} is already installed", &current_datapack, already_installed);
            continue;
        }

        progress.progress_update(ProgressUpdate::set_label(format!("Downloading datapack {}", &current_datapack.title)));

        let current_datapack_path = datapack_path.join(&current_datapack.file_name);

        // Do we need to download the ResourcePack?
        if !current_datapack_path.exists() || current_datapack_path.is_dir() {
            // Make sure that the parent directory exists
            fs::create_dir_all(&current_datapack_path.parent().unwrap()).await?;

            // ignore shaders that dont have a download url.
            if let Some(url) = &current_datapack.url {
                info!("downloading datapack {} from {}", &current_datapack.file_name, url);
                
                let retrieved_bytes = download_file(url, |a, b| {
                    progress.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadDatapack, get_progress(datapack_idx, a, b), max));
                }).await?;
                
                fs::write(&current_datapack_path, retrieved_bytes).await?;
                info!("Installed Datapack {} in world {}", &current_datapack.file_name, &current_datapack.world_name);
            }
        } else {
            info!("Datapack {} is already downloaded in world {}", &current_datapack.file_name, &current_datapack.world_name);
        }

        installed_datapacks.push(current_datapack.clone())
    }

    Ok(())
}