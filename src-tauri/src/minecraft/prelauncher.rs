use std::path::Path;
use std::ptr::null;
use std::sync::{Mutex, Arc};

use anyhow::Result;
use async_zip::read::mem::ZipFileReader;
use tracing::*;
use tokio::fs;
use tokio::io::AsyncReadExt;

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
pub(crate) async fn launch<D: Send + Sync>(norisk_token: &str, launch_manifest: NoRiskLaunchManifest, launching_parameter: LaunchingParameter, additional_mods: Vec<LoaderMod>, progress: LauncherData<D>, window: Arc<Mutex<tauri::Window>>) -> Result<()> {
    info!("Loading minecraft version manifest...");
    let mc_version_manifest = VersionManifest::download().await?;

    let build = &launch_manifest.build;
    let subsystem = &launch_manifest.subsystem;

    progress.progress_update(ProgressUpdate::set_max());
    progress.progress_update(ProgressUpdate::SetProgress(0));

    let data_directory = launching_parameter.data_path.clone();

    // Copy retrieve and copy mods from manifest
    clear_mods(&data_directory, &launch_manifest).await?;
    let installed_mods = retrieve_and_copy_mods(&data_directory, &launch_manifest, &launch_manifest.mods, &progress, &Vec::new(), &window).await?;
    retrieve_and_copy_mods(&data_directory, &launch_manifest, &additional_mods, &progress, &installed_mods, &window).await?;

    copy_custom_mods(&data_directory, &launch_manifest, &progress).await?;

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

    launcher::launch(norisk_token,&data_directory, launch_manifest, version, launching_parameter, progress, window).await?;
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

pub async fn retrieve_and_copy_mods(data: &Path, manifest: &NoRiskLaunchManifest, mods: &Vec<LoaderMod>, progress: &impl ProgressReceiver, already_installed_mods: &Vec<LoaderMod>, window: &Arc<Mutex<tauri::Window>>) -> Result<Vec<LoaderMod>> {
    let mod_cache_path = data.join("mod_cache");
    let mods_path = data.join("gameDir").join(&manifest.build.branch).join("mods");

    fs::create_dir_all(&mod_cache_path).await?;
    fs::create_dir_all(&mods_path).await?;

    let mut installed_mods: Vec<LoaderMod> = Vec::new();

    // Download and copy mods
    let max = get_max(mods.len());

    for (mod_idx, current_mod) in mods.iter().enumerate() {
        // Skip mods that are not needed
        if !current_mod.required && !current_mod.enabled {
            continue;
        }

        if already_installed_mods.iter().any(|loader_mod| {
            return loader_mod.is_same_slug(current_mod);
        }) {
            let already_installed = already_installed_mods.iter().find(|&loader_mod| {
                return loader_mod.is_same_slug(current_mod);
            }).unwrap();
            println!("Skipping Mod {:?} cuz {:?} is already installed",current_mod,already_installed);
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
                    let mut download_url: String = "".to_owned();
                    if (url.clone().is_some()) {
                        download_url = url.clone().unwrap();
                    } else {
                        let repository_url = manifest.repositories.get(repository).ok_or_else(|| LauncherError::InvalidVersionProfile(format!("There is no repository specified with the name {}", repository)))?;
                        let maven_artifact_path = get_maven_artifact_path(artifact)?;
                        download_url = format!("{}{}", repository_url, maven_artifact_path);
                    }

                    println!("downloading mod {} from {}", artifact, download_url);

                    let retrieved_bytes = download_file(&download_url, |a, b| {
                        progress.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskClientMods, get_progress(mod_idx, a, b), max));
                    }).await?;

                    fs::write(&current_mod_path, retrieved_bytes).await?;
                }
                _ => {}
            }
        }

        // Copy the mod.
        fs::copy(&current_mod_path, mods_path.join(format!("{}.jar", current_mod.name.replace(".jar","")))).await?;

        println!("Installed Mod {:?}",current_mod);
        installed_mods.push(current_mod.clone())
    }

    Ok(installed_mods)
}

pub async fn copy_custom_mods(data: &Path, manifest: &NoRiskLaunchManifest, progress: &impl ProgressReceiver) -> Result<()> {
    let mod_cache_path = data.join("custom_mods").join(format!("{}-{}", manifest.build.branch, manifest.build.mc_version));
    let mods_path = data.join("gameDir").join(&manifest.build.branch).join("mods");

    fs::create_dir_all(&mod_cache_path).await?;
    fs::create_dir_all(&mods_path).await?;

    // Copy all mods from custom_mods to mods
    let mut mods_read = fs::read_dir(&mod_cache_path).await?;
    while let Some(entry) = mods_read.next_entry().await? {
        if entry.file_type().await?.is_file() {
            progress.progress_update(ProgressUpdate::set_label(format!("Copied custom mod {}", entry.file_name().to_str().unwrap_or_default())));
            fs::copy(entry.path(), mods_path.join(entry.file_name())).await?;
        }
    }

    Ok(())
}
