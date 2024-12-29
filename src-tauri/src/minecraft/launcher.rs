use std::{collections::HashMap, path::{Path, PathBuf}};
use std::collections::HashSet;
use std::fmt::Write;
use std::process::exit;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::Result;
use futures::stream::{self, StreamExt};
use log::{debug, error, info};
use path_absolutize::*;
use tokio::{fs, fs::OpenOptions};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{app::api::ApiEndpoints, LAUNCHER_VERSION, minecraft::version::AssetObject, utils::{OS, OS_VERSION}};
use crate::app::api::NoRiskLaunchManifest;
use crate::app::gui::get_keep_local_assets;
use crate::app::nrc_cache::{NRCCache, RunnerInstance};
use crate::error::LauncherError;
use crate::minecraft::java::{find_java_binary, JavaRuntime, jre_downloader};
use crate::minecraft::progress::{get_max, get_progress, ProgressReceiver, ProgressUpdate, ProgressUpdateSteps};
use crate::minecraft::rule_interpreter;
use crate::minecraft::version::LibraryDownloadInfo;
use crate::utils::{download_file, sha1sum, zip_extract};

use super::version::VersionProfile;

pub struct LauncherData<D: Send + Sync> {
    pub instance_id: Uuid,
    pub instances: Arc<Mutex<Vec<RunnerInstance>>>,
    pub(crate) on_stdout: fn(&D, &[u8], Uuid) -> Result<()>,
    pub(crate) on_stderr: fn(&D, &[u8], Uuid) -> Result<()>,
    pub(crate) on_progress: fn(&D, ProgressUpdate, Uuid, Arc<Mutex<Vec<RunnerInstance>>>) -> Result<()>,
    pub(crate) data: Box<D>,
    pub(crate) terminator: tokio::sync::oneshot::Receiver<()>,
}

impl<D: Send + Sync> LauncherData<D> {
    /// Speichert die aktuelle Liste der RunnerInstances als JSON-Datei im angegebenen Pfad.
    pub fn store(&self) -> Result<(), crate::error::Error> {
        NRCCache::store_running_instances(&self.instances)?;
        Ok(())
    }
}


impl<D: Send + Sync> ProgressReceiver for LauncherData<D> {
    fn progress_update(&self, progress_update: ProgressUpdate) {
        let _ = (self.on_progress)(&self.data, progress_update, self.instance_id, self.instances.clone());
        //ui update
        let _ = (self.on_progress)(&self.data, ProgressUpdate::set_max(), self.instance_id, self.instances.clone());

        self.store().unwrap()
    }
}

pub async fn launch<D: Send + Sync>(multiple_instances: bool, norisk_token: &str, uuid: &str, data: &Path, manifest: NoRiskLaunchManifest, version_profile: VersionProfile, launching_parameter: LaunchingParameter, launcher_data: LauncherData<D>, window: Arc<Mutex<tauri::Window>>, instance_id: Uuid) -> Result<()> {
    let launcher_data_arc = Arc::new(launcher_data);

    let features: HashSet<String> = HashSet::new();

    info!("Determined OS to be {} {}", OS, OS_VERSION.clone());

    // JRE download
    let runtimes_folder = data.join("runtimes");
    if !runtimes_folder.exists() {
        fs::create_dir(&runtimes_folder).await?;
    }

    let java_bin = match &launching_parameter.custom_java_path {
        Some(path) => PathBuf::from(path),
        None => {
            info!("Checking for JRE...");
            launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.checkingJRE"));

            match find_java_binary(&runtimes_folder, manifest.build.jre_version).await {
                Ok(jre) => jre,
                Err(e) => {
                    error!("Failed to find JRE: {}", e);

                    info!("Download JRE...");
                    launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.downloadingJRE"));
                    jre_downloader::jre_download(&runtimes_folder, manifest.build.jre_version, |a, b| {
                        launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadJRE, get_progress(0, a, b), get_max(1)));
                    }).await?
                }
            }
        }
    };
    debug!("Java binary: {}", java_bin.to_str().unwrap());

    // Launch class path for JRE
    let mut class_path = String::new();

    // Client
    let versions_folder = data.join("versions");

    // Check if json has client download (or doesn't require one)
    if let Some(client_download) = version_profile.downloads.as_ref().and_then(|x| x.client.as_ref()) {
        let client_folder = versions_folder.join(&version_profile.id);
        fs::create_dir_all(&client_folder).await?;

        let client_jar = client_folder.join(format!("{}.jar", &version_profile.id));

        // Add client jar to class path
        write!(class_path, "{}{}", &client_jar.absolutize().unwrap().to_str().unwrap(), OS.get_path_separator()?)?;

        // Download client jar
        let requires_download = if !client_jar.exists() {
            debug!("Client Jar doesn't exists");
            true
        } else {
            let hash = sha1sum(&client_jar)?;
            debug!("Client Jar Hash {:?} {:?}",hash,client_download.sha1);
            hash != client_download.sha1
        };

        debug!("Downloading Client jar {:?}", requires_download);

        if requires_download {
            launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.downloadingClient"));

            let retrieved_bytes = download_file(&client_download.url, |a, b| {
                launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadClientJar, get_progress(0, a, b), get_max(1)));
            }).await?;

            fs::write(&client_jar, retrieved_bytes).await?;

            // After downloading, check sha1
            let hash = sha1sum(&client_jar)?;
            if hash != client_download.sha1 {
                anyhow::bail!("Client JAR download failed. SHA1 mismatch.");
            }
        }
    } else {
        return Err(LauncherError::InvalidVersionProfile("No client JAR downloads were specified.".to_string()).into());
    }

    // Libraries
    let libraries_folder = data.join("libraries");
    let natives_folder = data.join("natives");
    let natives_path = natives_folder.as_path();
    if natives_folder.exists() {
        debug!("Deleting Natives folder...");
        fs::remove_dir_all(&natives_folder).await.or_else(|e| if multiple_instances { Ok(()) } else { Err(e) })?;
    }
    fs::create_dir_all(&natives_folder).await?;

    let libraries_to_download = version_profile.libraries.iter().map(|x| x.to_owned()).collect::<Vec<_>>();
    // let libraries_downloaded = Arc::new(AtomicU64::new(0));
    let libraries_max = libraries_to_download.len() as u64;

    launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.checkingLibraries"));
    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadLibraries, 0, libraries_max));

    let class_paths: Vec<Result<Option<String>>> = stream::iter(
        libraries_to_download.into_iter().filter_map(|library| {
            // let download_count = libraries_downloaded.clone();
            let data_clone = launcher_data_arc.clone();
            let folder_clone = libraries_folder.to_path_buf();

            if !rule_interpreter::check_condition(&library.rules, &features).unwrap_or(false) {
                return None;
            }

            Some(async move {
                if let Some(natives) = &library.natives {
                    if let Some(required_natives) = natives.get(OS.get_simple_name()?) {
                        if let Some(classifiers) = library.downloads.as_ref().and_then(|x| x.classifiers.as_ref()) {
                            if let Some(artifact) = classifiers.get(required_natives).map(LibraryDownloadInfo::from) {
                                let path = artifact.download(library.name, folder_clone.as_path(), data_clone).await?;

                                info!("Natives zip extract: {:?}", path);
                                let file = OpenOptions::new().read(true).open(path).await?;
                                zip_extract(file, natives_path).await?;
                            }
                        } else {
                            return Err(LauncherError::InvalidVersionProfile("missing classifiers, but natives required.".to_string()).into());
                        }
                    }

                    return Ok(None);
                }

                // Download regular artifact
                let artifact = library.get_library_download()?;
                let path = artifact.download(library.name, folder_clone.as_path(), data_clone).await?;

                // Natives are not included in the classpath
                return if library.natives.is_none() {
                    return Ok(path.absolutize()?.to_str().map(|x| x.to_string()));
                } else {
                    Ok(None)
                };
            })
        })
    ).buffer_unordered(launching_parameter.concurrent_downloads as usize).collect().await;

    for x in class_paths {
        if let Some(library_path) = x? {
            write!(class_path, "{}{}", &library_path, OS.get_path_separator()?)?;
        }
    }

    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadLibraries, libraries_max, libraries_max));

    // Minecraft Assets
    let assets_folder = data.join("assets");
    let indexes_folder: PathBuf = assets_folder.join("indexes");
    let objects_folder: PathBuf = assets_folder.join("objects");

    fs::create_dir_all(&indexes_folder).await?;
    fs::create_dir_all(&objects_folder).await?;

    let asset_index_location = version_profile.asset_index_location.as_ref().ok_or_else(|| LauncherError::InvalidVersionProfile("Asset index unspecified".to_string()))?;
    let asset_index = asset_index_location.load_asset_index(&indexes_folder).await?;
    let asset_objects_to_download = asset_index.objects.values().map(|x| x.to_owned()).collect::<Vec<_>>();
    let assets_downloaded = Arc::new(AtomicU64::new(0));
    let asset_max = asset_objects_to_download.len() as u64;

    launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.checkingMinecraftAssets"));
    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadAssets, 0, asset_max));

    let _: Vec<Result<()>> = stream::iter(
        asset_objects_to_download.into_iter().map(|asset_object| {
            let download_count = assets_downloaded.clone();
            let data_clone = launcher_data_arc.clone();
            let folder_clone = objects_folder.clone();

            async move {
                let hash = asset_object.hash.clone();
                match asset_object.download_destructing(folder_clone, data_clone.clone()).await {
                    Ok(downloaded) => {
                        let curr = download_count.fetch_add(1, Ordering::Relaxed);

                        if downloaded {
                            // the progress bar is only being updated when a asset has been downloaded to improve speeds
                            data_clone.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadAssets, curr, asset_max));
                            data_clone.progress_update(ProgressUpdate::set_label(format!("translation.downloadedMinecraftAsset&hash%{}", hash)));
                        }
                    }
                    Err(err) => error!("Unable to download asset {}: {:?}", hash, err)
                }

                Ok(())
            }
        })
    ).buffer_unordered(launching_parameter.concurrent_downloads as usize).collect().await;

    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadAssets, asset_max, asset_max));

    let game_dir = data.join("gameDir").join(manifest.build.branch.clone());

    // Norisk Assets
    let keep_local_assets = match get_keep_local_assets() {
        Ok(keep_local_assets) => keep_local_assets,
        Err(err) => {
            error!("Error fetching keep_local_assets: {}", err);
            false
        }
    };

    if !keep_local_assets {
        let norisk_asset_dir = game_dir.join("NoRiskClient").join("assets");
        fs::create_dir_all(&norisk_asset_dir).await?;

        let json_data = ApiEndpoints::assets(manifest.build.branch.clone(), norisk_token, uuid).await;

        let norisk_asset_objects_to_download: HashMap<String, AssetObject> = match json_data {
            Ok(norisk_assets) => norisk_assets.objects,
            Err(err) => {
                info!("Error fetching norisk_assets: {}", err);
                HashMap::new()
            }
        };

        if norisk_asset_objects_to_download.len() > 0 {
            let norisk_assets_downloaded = Arc::new(AtomicU64::new(0));
            let norisk_asset_max = norisk_asset_objects_to_download.values().map(|x| x.to_owned()).collect::<Vec<_>>().len() as u64;

            launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.checkingNoriskAssets"));
            launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskAssets, 0, norisk_asset_max));

            let _: Vec<Result<()>> = stream::iter(
                norisk_asset_objects_to_download.clone().into_iter().map(|asset_object| {
                    let download_count = norisk_assets_downloaded.clone();
                    let data_clone = launcher_data_arc.clone();
                    let folder_clone = norisk_asset_dir.clone();
                    let game_dir_clone = game_dir.clone();
                    let branch_clone = manifest.build.branch.clone();

                    let is_non_cosmetic = !asset_object.0.starts_with("nrc-cosmetics/");

                    async move {
                        if is_non_cosmetic && game_dir_clone.join(&asset_object.0).exists() {
                            let curr = download_count.fetch_add(1, Ordering::Relaxed);
                            data_clone.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskAssets, curr, norisk_asset_max));
                            data_clone.progress_update(ProgressUpdate::set_label(format!("translation.verifiedNoriskAsset&fileName%{}", asset_object.1.hash)));
                            info!("Skipping Norisk asset download for non-cosmetic asset: {} since the file already exists!", asset_object.0);
                        } else {
                            let hash = asset_object.1.hash.clone();
    
                            match asset_object.1.download_norisk_cosmetic_destructing(branch_clone, asset_object.0, norisk_token.to_string(), if is_non_cosmetic { game_dir_clone } else { folder_clone }, data_clone.clone()).await {
                                Ok(downloaded) => {
                                    let curr = download_count.fetch_add(1, Ordering::Relaxed);
    
                                    if downloaded {
                                        // the progress bar is only being updated when a asset has been downloaded to improve speeds
                                        data_clone.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskAssets, curr, norisk_asset_max));
                                        data_clone.progress_update(ProgressUpdate::set_label(format!("translation.downloadedNoriskAsset&hash%{}", hash)));
                                    }
                                }
                                Err(err) => error!("Unable to download Norisk asset {}: {:?}", hash, err)
                            }
                        }

                        Ok(())
                    }
                })
            ).buffer_unordered(launching_parameter.concurrent_downloads as usize).collect().await;

            launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::DownloadNoRiskAssets, norisk_asset_max, norisk_asset_max));

            // Delete usused norisk assets

            verify_norisk_assets(&norisk_asset_dir.clone(), norisk_asset_objects_to_download, launcher_data_arc.clone()).await;
        }
    } else {
        info!("Skipping Norisk assets check & download.");
    }

    // Game
    let java_runtime = JavaRuntime::new(java_bin);

    let mut command_arguments = Vec::new();

    // JVM Args
    version_profile.arguments.add_jvm_args_to_vec(norisk_token, &mut command_arguments, &launching_parameter, &features)?;

    // Main class
    command_arguments.push(version_profile.main_class.as_ref().ok_or_else(|| LauncherError::InvalidVersionProfile("Main class unspecified".to_string()))?.to_owned());

    // Game args
    version_profile.arguments.add_game_args_to_vec(&mut command_arguments, &features)?;

    let mut mapped: Vec<String> = Vec::with_capacity(command_arguments.len());

    for x in command_arguments.iter() {
        mapped.push(
            process_templates(x, |output, param| {
                match param {
                    "auth_player_name" => output.push_str(&launching_parameter.auth_player_name),
                    "version_name" => output.push_str(&version_profile.id),
                    "game_directory" => output.push_str(game_dir.absolutize().unwrap().to_str().unwrap()),
                    "assets_root" => output.push_str(assets_folder.absolutize().unwrap().to_str().unwrap()),
                    "assets_index_name" => output.push_str(&asset_index_location.id),
                    "auth_uuid" => output.push_str(&launching_parameter.auth_uuid),
                    "auth_access_token" => output.push_str(&launching_parameter.auth_access_token),
                    "user_type" => output.push_str(&launching_parameter.user_type),
                    "version_type" => output.push_str(&version_profile.version_type),
                    "natives_directory" => output.push_str(natives_folder.absolutize().unwrap().to_str().unwrap()),
                    "launcher_name" => output.push_str("NoRiskClient"),
                    "launcher_version" => output.push_str(LAUNCHER_VERSION),
                    "classpath" => output.push_str(&class_path),
                    "user_properties" => output.push_str("{}"),
                    "clientid" => output.push_str(&launching_parameter.clientid),
                    "auth_xuid" => output.push_str(&launching_parameter.auth_xuid),
                    _ => return Err(LauncherError::UnknownTemplateParameter(param.to_owned()).into())
                };

                Ok(())
            })?
        );
    }

    launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.launching"));
    launcher_data_arc.progress_update(ProgressUpdate::set_to_max());

    let mut running_task = java_runtime.execute(mapped, &game_dir)?;

    if let Some(id) = running_task.id() {
        let mut runner_instances = launcher_data_arc.instances.lock().unwrap();
        if let Some(instance) = runner_instances.iter_mut().find(|r| r.id == instance_id) {
            debug!("Found Process Id {:?}",id);
            instance.p_id = Some(id);
        }
    }

    if !launching_parameter.keep_launcher_open {
        // Hide launcher window
        window.lock().unwrap().hide().unwrap();
    }

    let launcher_data = Arc::try_unwrap(launcher_data_arc)
        .unwrap_or_else(|_| panic!());
    launcher_data.store().unwrap();
    let terminator = launcher_data.terminator;
    let data = launcher_data.data;

    java_runtime.handle_io(&mut running_task, launcher_data.on_stdout, launcher_data.on_stderr, terminator, &data, instance_id)
        .await?;

    if !launching_parameter.keep_launcher_open {
        // Hide launcher window
        exit(0);
    }

    Ok(())
}

async fn verify_norisk_assets<D: Send + Sync>(dir: &Path, asset_objetcs: HashMap<String, AssetObject>, launcher_data_arc: Arc<LauncherData<D>>) {
    let mut keys_vec: Vec<&str> = vec![];
    for location in asset_objetcs.keys() {
        let parts: Vec<&str> = location.split("/").collect();

        if let Some(last_part) = parts.last() {
            keys_vec.push(last_part);
        }
    }
    keys_vec.push(".DS_Store");
    let file_names: &[&str] = &keys_vec;
    let mut verified: u64 = 0;

    launcher_data_arc.progress_update(ProgressUpdate::set_label("translation.verifyingNoriskAssets"));
    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::VerifyNoRiskAssets, verified, file_names.len() as u64));
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path().to_owned();
        if path.is_file() {
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();
            if !file_names.contains(&file_name.as_ref()) {
                if let Err(err) = fs::remove_file(&path).await {
                    info!("Failed to remove {}: {}", path.display(), err);
                } else {
                    info!("Removed file {} since it was not found in the asset objects for this branch.", path.display());
                }
            } else {
                verified += 1;
                launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::VerifyNoRiskAssets, verified, file_names.len() as u64));
                launcher_data_arc.progress_update(ProgressUpdate::set_label(format!("translation.verifiedNoriskAsset&fileName%{}", file_name)));
            }
        }
    }

    launcher_data_arc.progress_update(ProgressUpdate::set_for_step(ProgressUpdateSteps::VerifyNoRiskAssets, file_names.len() as u64, file_names.len() as u64));
}

pub struct LaunchingParameter {
    pub dev_mode: bool,
    pub force_server: Option<String>,
    pub memory: u64,
    pub data_path: PathBuf,
    pub custom_java_path: Option<String>,
    pub custom_java_args: String,
    pub auth_player_name: String,
    pub auth_uuid: String,
    pub auth_access_token: String,
    pub auth_xuid: String,
    pub clientid: String,
    pub user_type: String,
    pub keep_launcher_open: bool,
    pub concurrent_downloads: i32,
}

fn process_templates<F: Fn(&mut String, &str) -> Result<()>>(input: &String, retriever: F) -> Result<String> {
    let mut output = String::with_capacity(input.len() * 3 / 2);

    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '$' && chars.peek().map_or(false, |&x| x == '{') {
            // Consuuuuume the '{'
            chars.next();

            let mut template_arg = String::with_capacity(input.len() - 3);

            let mut c;

            loop {
                c = chars.next().ok_or_else(|| LauncherError::InvalidVersionProfile("invalid template, missing '}'".to_string()))?;

                if c == '}' {
                    break;
                }
                if !matches!(c, 'a'..='z' | 'A'..='Z' | '_' | '0'..='9') {
                    return Err(LauncherError::InvalidVersionProfile(format!("invalid character in template: '{}'", c)).into());
                }

                template_arg.push(c);
            }

            retriever(&mut output, template_arg.as_str())?;
            continue;
        }

        output.push(c);
    }

    Ok(output)
}
