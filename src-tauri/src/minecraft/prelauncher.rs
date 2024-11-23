use std::path::Path;
use std::sync::{Mutex, Arc};

use anyhow::{Ok, Result};
use log::{debug, info, warn};
use tokio::fs;
use uuid::Uuid;

use crate::app::api::{LoaderSubsystem, ModSource, LoaderMod, NoRiskLaunchManifest};
use crate::error::LauncherError;
use crate::LAUNCHER_DIRECTORY;
use crate::minecraft::launcher;
use crate::minecraft::launcher::{LauncherData, LaunchingParameter};
use crate::minecraft::progress::{get_max, get_progress, ProgressReceiver, ProgressUpdate, ProgressUpdateSteps};
use crate::minecraft::version::{VersionManifest, VersionProfile};
use crate::utils::{download_file, get_maven_artifact_path};

///
/// Prelaunching client
///
pub(crate) async fn launch<D: Send + Sync>(multiple_instances: bool, norisk_token: &str, uuid: &str, launch_manifest: NoRiskLaunchManifest, launching_parameter: LaunchingParameter, additional_mods: Vec<LoaderMod>, progress: LauncherData<D>, window: Arc<Mutex<tauri::Window>>, instance_id: Uuid) -> Result<()> {
    info!("Loading minecraft version manifest...");
    let data_path = LAUNCHER_DIRECTORY.data_dir().join("gameDir").join(&launch_manifest.build.branch).join("nrc_cache");
    let mc_version_manifest = VersionManifest::download(&data_path).await?;

    let build = &launch_manifest.build;
    let subsystem = &launch_manifest.subsystem;

    progress.progress_update(ProgressUpdate::set_max());
    progress.progress_update(ProgressUpdate::SetProgress(0));

    let data_directory = launching_parameter.data_path.clone();

    // Copy retrieve and copy mods from manifest
    clear_mods(&data_directory, &launch_manifest).await.or_else(|e| if multiple_instances { Ok(()) } else { Err(e) })?;
    retrieve_and_copy_mods(&data_directory, &launch_manifest, &launch_manifest.mods, &additional_mods, &progress).await?;
    retrieve_and_copy_mods(&data_directory, &launch_manifest, &additional_mods, &additional_mods, &progress).await?;

    info!("Loading version profile...");
    let manifest_url = match subsystem {
        LoaderSubsystem::Fabric { manifest, .. } => manifest
            .replace("{MINECRAFT_VERSION}", &build.mc_version)
            .replace("{FABRIC_LOADER_VERSION}", &build.fabric_loader_version),
        LoaderSubsystem::Forge { manifest, .. } => manifest.clone()
    };
    let mut version = VersionProfile::download(&data_path.join("child_sub_system.json"), &manifest_url).await?;

    if let Some(inherited_version) = &version.inherits_from {
        let url = mc_version_manifest.versions
            .iter()
            .find(|x| &x.id == inherited_version)
            .map(|x| &x.url)
            .ok_or_else(|| LauncherError::InvalidVersionProfile(format!("unable to find inherited version manifest {}", inherited_version)))?;

        debug!("Determined {}'s download url to be {}", inherited_version, url);
        info!("Downloading inherited version {}...", inherited_version);

        let parent_version = VersionProfile::download(&data_path.join("parent_sub_system.json"), url).await?;

        version.merge(parent_version)?;
    }

    info!("Launching {}...", launch_manifest.build.branch);

    launcher::launch(multiple_instances, norisk_token, uuid, &data_directory, launch_manifest, version, launching_parameter, progress, window, instance_id).await?;
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

        progress.progress_update(ProgressUpdate::set_label(format!("translation.downloadingRecommendedMod&mod%{}", current_mod.name)));

        let current_mod_path = mod_cache_path.join(current_mod.source.get_path()?);

        // Do we need to download the mod?
        if !current_mod_path.exists() && current_mod.source.get_repository() != "CUSTOM".to_string() {
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
        } else if !current_mod_path.exists() && current_mod.source.get_repository() == "CUSTOM".to_string() {
            // Broken custom mod path -> ignore
            installed_mods.push(current_mod.clone());
            warn!("Skipping Mod {:?} cuz it's a custom mod with a broken / non existing path!",current_mod);
            continue;
        }

        // Copy the mod.
        fs::copy(&current_mod_path, mods_path.join(format!("{}.jar", current_mod.name.replace(".jar","")))).await?;

        info!("Installed Mod {:?}",current_mod);
        installed_mods.push(current_mod.clone())
    }

    Ok(())
}
