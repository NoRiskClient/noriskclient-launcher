use std::{path::PathBuf, sync::{Arc, Mutex}, thread};

use directories::UserDirs;
use reqwest::{multipart::{Form, Part}};
use tauri::{Manager, Window};
use tauri::api::dialog::blocking::message;
use tokio::{fs, io::AsyncReadExt};
use tracing::{debug, error, info};

use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY, minecraft::{launcher::{LauncherData, LaunchingParameter}, prelauncher, progress::ProgressUpdate}};
use crate::app::api::{LoginData, NoRiskLaunchManifest};
use crate::app::cape_api::{Cape, CapeApiEndpoints};
use crate::app::mclogs_api::{McLogsApiEndpoints, McLogsUploadResponse};
use crate::app::modrinth_api::{CustomMod, InstalledMods, ModInfo, ModrinthApiEndpoints, ModrinthProject, ModrinthSearchRequestParams, ModrinthSearchResponse};
use crate::minecraft::auth;
use crate::utils::percentage_of_total_memory;

use super::{api::{ApiEndpoints, LoaderMod}, app_data::LauncherOptions};

struct RunnerInstance {
    terminator: tokio::sync::oneshot::Sender<()>,
}

struct AppState {
    runner_instance: Arc<Mutex<Option<RunnerInstance>>>,
}


#[derive(serde::Deserialize)]
struct FileData {
    name: String,
    location: String,
}

#[derive(serde::Deserialize)]
struct MinecraftProfile {
    properties: Vec<MinecraftProfileProperty>,
}

#[derive(serde::Deserialize)]
struct MinecraftProfileProperty {
    name: String,
    value: String,
}

#[derive(serde::Serialize)]
struct NewMinecraftSkinBody {
    variant: String,
    file: Vec<u8>,
}

#[tauri::command]
async fn check_online_status() -> Result<(), String> {
    //TODO
    /*HTTP_CLIENT.get("https://api.norisk.gg/launcherapi")
        .send().await
        .map_err(|e| format!("unable to connect to api.norisk.gg: {:}", e))?
        .error_for_status()
        .map_err(|e| format!("api.norisk.gg returned an error: {:}", e))?;*/
    Ok(())
}

#[tauri::command]
fn open_url(url: &str) -> Result<(), String> {
    open::that(url)
        .map_err(|e| format!("unable to open url: {:?}", e))?;
    Ok(())
}

#[tauri::command]
async fn upload_cape(norisk_token: &str, window: tauri::Window) -> Result<(), String> {
    debug!("Uploading Cape...");
    use std::path::PathBuf;
    use tauri::api::dialog::blocking::FileDialogBuilder; // Note the updated import

    let dialog_result = FileDialogBuilder::new()
        .set_title("Select Cape")
        .add_filter("Pictures", &["png"])
        .pick_file();

    // dialog_result will be of type Option<PathBuf> now.

    match CapeApiEndpoints::upload_cape(norisk_token, dialog_result.unwrap()).await {
        Ok(result) => {
            message(Some(&window), "Cape Upload", result);
        }
        Err(err) => {
            message(Some(&window), "Cape Error", err);
        }
    }
    Ok(())
}

#[tauri::command]
async fn equip_cape(norisk_token: &str, hash: &str, window: tauri::Window) -> Result<(), String> {
    debug!("Equiping Cape...");
    use std::path::PathBuf;
    use tauri::api::dialog::blocking::FileDialogBuilder; // Note the updated import

    // dialog_result will be of type Option<PathBuf> now.

    match CapeApiEndpoints::equip_cape(norisk_token, hash).await {
        Ok(result) => {
            message(Some(&window), "Cape Upload", result);
        }
        Err(err) => {
            message(Some(&window), "Cape Error", err);
        }
    }
    Ok(())
}

#[tauri::command]
async fn get_featured_mods(branch: &str, window: tauri::Window) -> Result<Vec<ModInfo>, String> {
    debug!("Getting Featured Mods...");

    match ApiEndpoints::norisk_featured_mods(&branch).await {
        Ok(result) => {
            // fetch mod info for each mod
            let mut mod_infos: Vec<ModInfo> = Vec::new();
            for mod_id in result {
                match ModrinthApiEndpoints::get_mod_info(&*mod_id).await {
                    Ok(mod_info) => {
                        mod_infos.push(mod_info);
                    }
                    Err(err) => {
                        message(Some(&window), "Modrinth Error", err.to_string());
                    }
                }
            }
            Ok(mod_infos)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn search_mods(params: ModrinthSearchRequestParams, window: tauri::Window) -> Result<ModrinthSearchResponse, String> {
    debug!("Searching Mods...");

    match ModrinthApiEndpoints::search_mods(&params).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn install_mod_and_dependencies(slug: &str, params: &str, required_mods: Vec<LoaderMod>, window: tauri::Window) -> Result<CustomMod, String> {
    println!("Installing Mod And Dependencies...");
    match ModrinthApiEndpoints::install_mod_and_dependencies(slug, params, &required_mods).await {
        Ok(installed_mod) => {
            Ok(installed_mod)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_mod_version(slug: &str, params: &str, window: tauri::Window) -> Result<Vec<ModrinthProject>, String> {
    println!("Searching Mod Version...");

    match ModrinthApiEndpoints::get_mod_version(slug, params).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn delete_cape(norisk_token: &str, window: tauri::Window) -> Result<(), String> {
    debug!("Deleting Cape...");
    // dialog_result will be of type Option<PathBuf> now.

    match CapeApiEndpoints::delete_cape(norisk_token).await {
        Ok(result) => {
            message(Some(&window), "Cape Deletion", result);
        }
        Err(err) => {
            message(Some(&window), "Cape Error", err);
        }
    }
    Ok(())
}

#[tauri::command]
async fn request_trending_capes(norisk_token: &str, alltime: u32, limit: u32) -> Result<Vec<Cape>, String> {
    match CapeApiEndpoints::request_trending_capes(norisk_token, alltime, limit).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err("Error Requesting Trending Capes".to_string())
        }
    }
}

#[tauri::command]
async fn request_owned_capes(norisk_token: &str, limit: u32) -> Result<Vec<Cape>, String> {
    match CapeApiEndpoints::request_owned_capes(norisk_token, limit).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err("Error Requesting Owned Capes".to_string())
        }
    }
}

#[tauri::command]
async fn download_template_and_open_explorer() -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;

    let template_url = "https://dl.hglabor.de/capes/prod/template.png";
    let user_dirs = UserDirs::new().unwrap();
    let downloads_dir = user_dirs.download_dir().unwrap();
    debug!("Downloads directory: {:?}", downloads_dir);
    let response = HTTP_CLIENT.get(template_url).send().await.map_err(|e| format!("Error downloading template: {:?}", e))?;
    let template_bytes = response.bytes().await.map_err(|e| format!("Error reading template bytes: {:?}", e))?;

    let mut file = File::create(downloads_dir.join("nrc_cape_template.png")).map_err(|e| format!("Error creating file: {:?}", e))?;
    file.write_all(&template_bytes).map_err(|e| format!("Error writing file: {:?}", e))?;

    CapeApiEndpoints::show_in_folder(downloads_dir.join("nrc_cape_template.png").into_os_string().to_str().unwrap());

    Ok(())
}


#[tauri::command]
async fn get_options() -> Result<LauncherOptions, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    let options = LauncherOptions::load(config_dir).await.unwrap_or_default(); // default to basic options if unable to load

    Ok(options)
}

#[tauri::command]
async fn get_installed_mods(branch: &str, options: LauncherOptions) -> Result<InstalledMods, String> {
    let game_dir = options.data_path_buf().join("gameDir").join(branch);
    return match tokio::fs::create_dir_all(&game_dir).await {
        Ok(_) => {
            Ok(InstalledMods::load(&game_dir).await.unwrap_or_default()) // default to basic options if unable to load
        }
        Err(err) => {
            Err(err.to_string())
        }
    };
}

#[tauri::command]
async fn get_custom_mods_filenames(options: LauncherOptions, branch: &str, mc_version: &str) -> Result<Vec<String>, String> {
    let custom_mod_folder = options.data_path_buf().join("custom_mods").join(format!("{}-{}", branch, mc_version));
    let names = ModrinthApiEndpoints::get_custom_mod_names(&custom_mod_folder).await.map_err(|e| format!("unable to load config filenames: {:?}", e))?;
    Ok(names)
}

#[tauri::command]
async fn get_custom_mods_folder(options: LauncherOptions, branch: &str, mc_version: &str) -> Result<String, String> {
    let custom_mod_folder = options.data_path_buf().join("custom_mods").join(format!("{}-{}", branch, mc_version));
    return custom_mod_folder.to_str().map(|s| s.to_string()).ok_or_else(|| "Error converting path to string".to_string());
}

#[tauri::command]
async fn save_custom_mods_to_folder(options: LauncherOptions, branch: &str, mc_version: &str, file: FileData) -> Result<(), String> {
    let file_path = options.data_path_buf().join("custom_mods").join(format!("{}-{}", branch, mc_version)).join(file.name.clone());

    println!("Saving {} to {}-{} custom mods folder.", file.name.clone(), branch, mc_version);

    if let Err(err) = fs::copy(PathBuf::from(file.location), &file_path).await {
        return Err(format!("Error saving custom mod {}: {}", file.name, err));
    }

    Ok(())
}

#[tauri::command]
async fn store_installed_mods(branch: &str, options: LauncherOptions, installed_mods: InstalledMods) -> Result<(), String> {
    let game_dir = options.data_path_buf().join("gameDir").join(branch);
    return match tokio::fs::create_dir_all(&game_dir).await {
        Ok(_) => {
            installed_mods.store(&game_dir).await.map_err(|e| format!("unable to store config data: {:?}", e))?; // default to basic options if unable to load
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
        }
    };
}

#[tauri::command]
async fn get_player_skins(uuid: String) -> Result<Vec<String>, String> {
    let minecraft_profile: Result<MinecraftProfile, reqwest::Error> = HTTP_CLIENT.get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", uuid))
        .send().await
        .map_err(|e| format!("unable to connect to sessionserver.mojang.com: {:}", e))?
        .error_for_status()
        .map_err(|e| format!("sessionserver.mojang.com returned an error: {:}", e))?
        .json().await;
        

    match minecraft_profile {
        Ok(profile) => {
            let mut textures: Vec<String> = vec![];
            for property in profile.properties.iter() {
                if property.name == "textures" {
                    textures.push(property.value.clone())
                }
            }
            Ok(textures)
        },
        Err(_) => Err("Failed to retrieve Minecraft profile".to_string()), // You can provide a custom error message here.
    }
}

#[tauri::command]
async fn save_player_skin(location: String, slim: bool, access_token: String) -> Result<(), String> {
    let file_data = match tokio::fs::read(&location).await {
        Ok(data) => data,
        Err(e) => return Err(e.to_string()),
    };

    let part = Part::bytes(file_data)
        .file_name("skin.png");

    let response = HTTP_CLIENT.post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(access_token)
        .multipart(Form::new().text("variant", if slim { "slim" } else { "classic" }).part("file", part))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        println!("Skin {} saved successfully.", &location);
        Ok(())
    } else {
        Err(format!("Failed to save the new skin. Status code: {}", response.status()))
    }
}

#[tauri::command]
async fn read_local_skin_file(location: String) -> Result<String, String> {
    match fs::File::open(&location).await {
        Ok(mut file) => {
            let mut buffer = Vec::new();
            if let Err(err) = file.read_to_end(&mut buffer).await {
                return Err(format!("Failed to read the file: {}", err));
            }
            Ok(base64::encode(buffer))
        },
        Err(err) => {
            Err(format!("Failed to open the file: {}", err))
        }
    }
}

#[tauri::command]
async fn read_remote_image_file(location: String) -> Result<String, String> {
    let response = HTTP_CLIENT
        .get(&location)
        .send()
        .await
        .map_err(|e| format!("unable to connect to {}: {:}", e, location))?
        .error_for_status()
        .map_err(|e| format!("{} returned an error: {:}", location, e))?
        .bytes()
        .await;

    match response {
        Ok(bytes) => Ok(base64::encode(&bytes)),
        Err(_) => Err("Failed to fetch cape from remote resource".to_string()),
    }
}

#[tauri::command]
async fn store_options(options: LauncherOptions) -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    options.store(config_dir)
        .await
        .map_err(|e| format!("unable to store config data: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn request_norisk_branches() -> Result<Vec<String>, String> {
    let branches = ApiEndpoints::norisk_branches()
        .await
        .map_err(|e| format!("unable to request branches: {:?}", e))?;
    Ok(branches)
}

#[tauri::command]
async fn get_launch_manifest(branch: &str) -> Result<NoRiskLaunchManifest, String> {
    let manifest = ApiEndpoints::launch_manifest(branch).await
        .map_err(|e| format!("unable to request launch manifest: {:?}", e))?;
    Ok(manifest)
}

#[tauri::command]
async fn upload_logs(log: String) -> Result<McLogsUploadResponse, String> {
    let log_response = McLogsApiEndpoints::upload_logs(log).await
        .map_err(|e| format!("unable to upload logs: {:?}", e))?;
    Ok(log_response)
}

#[tauri::command]
async fn login_norisk_microsoft() -> Result<LoginData, String> {
    let auth_prepare_response = ApiEndpoints::auth_prepare_response().await;
    match auth_prepare_response {
        Ok(response) => {
            // Hier kannst du auf die Daten von 'response' zugreifen
            let url = response.url;
            let id = response.id;
            let _ = open_url(url.as_str());

            let login_data = ApiEndpoints::await_auth_response(id).await;
            match login_data {
                Ok(response) => {
                    info!("Received NoRisk Auth Response");
                    Ok(response)
                }
                Err(err) => {
                    Err(format!("await auth error: {:?}", err))
                }
            }
        }
        Err(err) => {
            Err(format!("await prepare response error: {:?}", err))
        }
    }
}

fn handle_stdout(window: &Arc<std::sync::Mutex<Window>>, data: &[u8]) -> anyhow::Result<()> {
    let data = String::from_utf8(data.to_vec())?;
    if data.is_empty() {
        return Ok(()); // ignore empty lines
    }

    info!("{}", data);
    window.lock().unwrap().emit("process-output", data)?;
    Ok(())
}

fn handle_stderr(window: &Arc<std::sync::Mutex<Window>>, data: &[u8]) -> anyhow::Result<()> {
    let data = String::from_utf8(data.to_vec())?;
    if data.is_empty() {
        return Ok(()); // ignore empty lines
    }

    error!("{}", data);
    window.lock().unwrap().emit("process-output", data)?;
    Ok(())
}

fn handle_progress(window: &Arc<std::sync::Mutex<Window>>, progress_update: ProgressUpdate) -> anyhow::Result<()> {
    window.lock().unwrap().emit("progress-update", progress_update)?;
    Ok(())
}

#[tauri::command]
async fn run_client(branch: String, login_data: LoginData, options: LauncherOptions, mods: Vec<LoaderMod>, window: Window, app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("Starting Client with branch {}",branch);
    let window_mutex = Arc::new(std::sync::Mutex::new(window));

    let parameters = LaunchingParameter {
        dev_mode: options.experimental_mode,
        memory: percentage_of_total_memory(options.memory_percentage),
        data_path: options.data_path_buf(),
        custom_java_path: if !options.custom_java_path.is_empty() { Some(options.custom_java_path) } else { None },
        auth_player_name: login_data.username,
        auth_uuid: login_data.uuid,
        auth_access_token: login_data.mc_token,
        auth_xuid: "x".to_string(),
        clientid: auth::AZURE_CLIENT_ID.to_string(),
        user_type: "msa".to_string(),
        keep_launcher_open: options.keep_launcher_open,
        concurrent_downloads: options.concurrent_downloads,
    };

    let runner_instance = &app_state.runner_instance;

    if runner_instance.lock().map_err(|e| format!("unable to lock runner instance: {:?}", e))?.is_some() {
        return Err("client is already running".to_string());
    }

    info!("Loading launch manifest...");
    let launch_manifest = ApiEndpoints::launch_manifest(&branch)
        .await
        .map_err(|e| format!("unable to request launch manifest: {:?}", e))?;

    let (terminator_tx, terminator_rx) = tokio::sync::oneshot::channel();

    *runner_instance.lock().map_err(|e| format!("unable to lock runner instance: {:?}", e))?
        = Some(RunnerInstance { terminator: terminator_tx });

    let copy_of_runner_instance = runner_instance.clone();

    thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let keep_launcher_open = parameters.keep_launcher_open;

                if let Err(e) = prelauncher::launch(
                    &login_data.norisk_token,
                    launch_manifest,
                    parameters,
                    mods,
                    LauncherData {
                        on_stdout: handle_stdout,
                        on_stderr: handle_stderr,
                        on_progress: handle_progress,
                        data: Box::new(window_mutex.clone()),
                        terminator: terminator_rx,
                    },
                    window_mutex.clone(),
                ).await {
                    if !keep_launcher_open {
                        window_mutex.lock().unwrap().show().unwrap();
                    }

                    window_mutex.lock().unwrap().emit("client-error", format!("Failed to launch client: {:?}", e)).unwrap();
                    handle_stderr(&window_mutex, format!("Failed to launch client: {:?}", e).as_bytes()).unwrap();
                };

                *copy_of_runner_instance.lock().map_err(|e| format!("unable to lock runner instance: {:?}", e)).unwrap()
                    = None;
                window_mutex.lock().unwrap().emit("client-exited", ()).unwrap()
            });
    });


    Ok(())
}

#[tauri::command]
async fn terminate(app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut lck = app_state.runner_instance.lock()
        .map_err(|e| format!("unable to lock runner instance: {:?}", e))?;

    if let Some(inst) = lck.take() {
        info!("Sending sigterm");
        inst.terminator.send(()).unwrap();
    }
    Ok(())
}

#[tauri::command]
async fn refresh_via_norisk(login_data: LoginData) -> Result<LoginData, String> {
    let account = login_data.refresh_maybe_fixed().await
        .map_err(|e| format!("unable to refresh: {:?}", e))?;
    Ok(account)
}

#[tauri::command]
async fn mc_name_by_uuid(uuid: &str) -> Result<String, ()> {
    let response = CapeApiEndpoints::mc_name_by_uuid(uuid).await;
    match response {
        Ok(user) => {
            Ok(user)
        }
        Err(err) => {
            debug!("Error Requesting Mc Name {:?}",err);
            Err(())
        }
    }
}

#[tauri::command]
async fn get_cape_hash_by_uuid(uuid: &str) -> Result<String, ()> {
    let response = CapeApiEndpoints::cape_hash_by_uuid(uuid).await;
    match response {
        Ok(user) => {
            Ok(user)
        }
        Err(err) => {
            debug!("Error Requesting Cape Hash {:?}",err);
            Err(())
        }
    }
}

#[tauri::command]
async fn mem_percentage(memory_percentage: i32) -> i64 {
    percentage_of_total_memory(memory_percentage)
}

#[tauri::command]
async fn default_data_folder_path() -> Result<String, String> {
    let data_directory = LAUNCHER_DIRECTORY.data_dir().to_str();

    match data_directory {
        None => Err("unable to get data folder path".to_string()),
        Some(path) => Ok(path.to_string())
    }
}

#[tauri::command]
async fn clear_data(options: LauncherOptions) -> Result<(), String> {
    let _ = store_options(LauncherOptions::default()).await;

    ["assets", "gameDir", "libraries", "mod_cache", "natives", "runtimes", "versions"]
        .iter()
        .map(|dir| options.data_path_buf().join(dir))
        .filter(|dir| dir.exists())
        .map(std::fs::remove_dir_all)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("unable to clear data: {:?}", e))?;
    Ok(())
}

/// Runs the GUI and returns when the window is closed.
pub fn gui_main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs_watch::init())
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            Ok(())
        })
        .manage(AppState {
            runner_instance: Arc::new(Mutex::new(None))
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            check_online_status,
            get_options,
            store_options,
            request_norisk_branches,
            login_norisk_microsoft,
            upload_cape,
            equip_cape,
            get_player_skins,
            save_player_skin,
            read_local_skin_file,
            read_remote_image_file,
            get_cape_hash_by_uuid,
            mc_name_by_uuid,
            delete_cape,
            search_mods,
            get_featured_mods,
            run_client,
            download_template_and_open_explorer,
            request_trending_capes,
            request_owned_capes,
            refresh_via_norisk,
            clear_data,
            get_installed_mods,
            get_custom_mods_folder,
            save_custom_mods_to_folder,
            install_mod_and_dependencies,
            get_mod_version,
            upload_logs,
            get_launch_manifest,
            store_installed_mods,
            get_custom_mods_filenames,
            mem_percentage,
            default_data_folder_path,
            terminate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
