use std::{
    collections::HashMap,
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use std::convert::From;
use std::fs::File;
use std::io::BufRead;
use std::io::Write;

use anyhow::Result;
use chrono::Utc;
use directories::UserDirs;
use dirs::data_dir;
use log::{debug, error, info};
use minecraft_client_rs::Client;
use rand::Rng;
use regex::Regex;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessExt, System, SystemExt};
use tauri::{Manager, UserAttentionType, Window, WindowEvent};
use tauri::api::dialog::blocking::FileDialogBuilder;
use tokio::{fs, io::AsyncReadExt};
use uuid::Uuid;

use crate::{
    custom_servers::{
        manager::CustomServerManager,
        models::{CustomServer, CustomServerEventPayload},
        providers::{
            bukkit::BukkitProvider,
            fabric::{FabricLoaderVersion, FabricProvider, FabricVersion},
            folia::{FoliaBuilds, FoliaManifest, FoliaProvider},
            forge::{ForgeManifest, ForgeProvider},
            neoforge::{NeoForgeManifest, NeoForgeProvider},
            paper::{PaperBuilds, PaperManifest, PaperProvider},
            purpur::{PurpurProvider, PurpurVersions},
            quilt::{QuiltManifest, QuiltProvider},
            spigot::SpigotProvider,
            vanilla::{VanillaManifest, VanillaProvider, VanillaVersions},
        },
    },
    HTTP_CLIENT,
    LAUNCHER_DIRECTORY,
    minecraft::{
        launcher::{LauncherData, LaunchingParameter},
        prelauncher,
        progress::ProgressUpdate,
    }, utils::{McDataHandler, total_memory},
};
use crate::addons::datapack_manager::DataPackManager;
use crate::addons::mod_manager::ModManager;
use crate::addons::resourcepack_manager::ResourcePackManager;
use crate::addons::shader_manager::ShaderManager;
use crate::app::api::{LoginData, NoRiskLaunchManifest};
use crate::app::cape_api::{Cape, CapeApiEndpoints};
use crate::app::mclogs_api::{McLogsApiEndpoints, McLogsUploadResponse};
use crate::app::modrinth_api::{
    CustomMod, ModInfo, ModrinthApiEndpoints, ModrinthModsSearchResponse, ModrinthProject,
    ModrinthSearchRequestParams,
};
use crate::app::nrc_cache::{AppState, NRCCache, OutputData, RunnerInstance};
use crate::error::Error;
use crate::error::ErrorKind;
use crate::error::ErrorKind::OtherError;
use crate::LAUNCHER_VERSION;
use crate::minecraft::auth;
use crate::minecraft::minecraft_auth::{Credentials, MinecraftAuthStore};
use crate::minecraft::progress::ClientProgressUpdate;

use super::{api::{
    ApiEndpoints, CustomServersResponse, FeaturedServer, LoaderMod, NoRiskUserMinimal,
    WhitelistSlots,
}, app_data::{
    Announcement, ChangeLog, LastViewedPopups,
    LauncherOptions, LauncherProfiles,
}, modrinth_api::{
    Datapack, DatapackInfo, ModrinthDatapacksSearchResponse, ModrinthResourcePacksSearchResponse, ModrinthShadersSearchResponse, ResourcePack, ResourcePackInfo, Shader, ShaderInfo
}};

#[derive(Debug, Deserialize, Serialize)]
pub struct OnlineStatusInfo {
    pub online: bool,
    #[serde(rename = "onlinePlayers")]
    pub online_players: u32,
}

#[derive(Deserialize)]
pub struct FileData {
    pub name: String,
    pub location: String,
}

#[derive(Deserialize)]
struct MinecraftProfile {
    properties: Vec<MinecraftProfileProperty>,
}

#[derive(Deserialize)]
struct MinecraftProfileProperty {
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct PlayerDBData {
    data: PlayerDBEntry,
}

#[derive(Deserialize)]
struct PlayerDBEntry {
    player: Option<PlayerDBPlayer>,
}

#[derive(Deserialize)]
struct PlayerDBPlayer {
    id: String,
}

#[tauri::command]
async fn check_online_status() -> Result<OnlineStatusInfo, String> {
    ApiEndpoints::norisk_api_status()
        .await
        .map_err(|e| format!("unable to check online status: {:?}", e))
}

#[tauri::command]
fn get_launcher_version() -> String {
    LAUNCHER_VERSION.to_string()
}

#[tauri::command]
async fn check_privacy_policy() -> Result<bool, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    let file = config_dir.join("privacy_policy_accepted.txt");
    if !file.exists() {
        println!("Privacy policy file does not exist");
        return Ok(false);
    }

    let file_content = fs::read_to_string(&file)
        .await
        .map_err(|e| format!("unable to read privacy_policy_accepted file: {:?}", e))?;

    let is_accpeted = file_content.starts_with("accepted=true");
    println!("Privacy policy is accepted: {}", is_accpeted);

    Ok(is_accpeted)
}

#[tauri::command]
async fn accept_privacy_policy() -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    let file = config_dir.join("privacy_policy_accepted.txt");
    let date = Utc::now().to_rfc3339();

    let formatted_text = format!("accepted=true\nat={}\nurl=https://norisk.gg/privacy-policy\n", &date);
    let text = formatted_text.as_bytes();

    if file.exists() {
        info!("Removing old privacy_policy_accepted file: {:?}", file);
        fs::remove_file(&file)
            .await
            .map_err(|e| format!("unable to remove privacy_policy_accepted file: {:?}", e))?;
    }

    info!("Creating privacy_policy_accepted file: {:?}", file);
    fs::write(&file, text)
        .await
        .map_err(|e| format!("unable to create privacy_policy_accepted file: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn upload_cape(norisk_token: &str, uuid: &str) -> Result<String, String> {
    debug!("Uploading Cape...");

    let dialog_result = FileDialogBuilder::new()
        .set_title("Select Cape")
        .add_filter("Pictures", &["png"])
        .pick_file();

    CapeApiEndpoints::upload_cape(norisk_token, uuid, dialog_result.unwrap()).await
}

#[tauri::command]
async fn equip_cape(norisk_token: &str, uuid: &str, hash: &str) -> Result<(), String> {
    debug!("Equiping Cape...");
    CapeApiEndpoints::equip_cape(norisk_token, uuid, hash).await
}

#[tauri::command]
async fn delete_cape(norisk_token: &str, uuid: &str, hash: &str) -> Result<(), String> {
    debug!("Deleting Cape...");
    CapeApiEndpoints::delete_cape(norisk_token, uuid, hash).await
}

#[tauri::command]
async fn get_mod_author(slug: &str) -> Result<String, Error> {
    ModManager::get_mod_author(slug).await
}

#[tauri::command]
async fn get_featured_mods(branch: &str, mc_version: &str) -> Result<Vec<ModInfo>, Error> {
    ModManager::get_featured_mods(branch, mc_version).await
}

#[tauri::command]
async fn get_featured_resourcepacks(
    branch: &str,
    mc_version: &str,
) -> Result<Vec<ResourcePackInfo>, Error> {
    ResourcePackManager::get_featured_resourcepacks(branch, mc_version).await
}

#[tauri::command]
async fn get_featured_shaders(branch: &str, mc_version: &str) -> Result<Vec<ShaderInfo>, Error> {
    ShaderManager::get_featured_shaders(branch, mc_version).await
}

#[tauri::command]
async fn get_featured_datapacks(
    branch: &str,
    mc_version: &str,
) -> Result<Vec<DatapackInfo>, Error> {
    DataPackManager::get_featured_datapacks(branch, mc_version).await
}

#[tauri::command]
async fn get_blacklisted_mods() -> Result<Vec<String>, Error> {
    ApiEndpoints::norisk_blacklisted_mods()
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
async fn get_blacklisted_resourcepacks() -> Result<Vec<String>, Error> {
    ApiEndpoints::norisk_blacklisted_resourcepacks()
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
async fn get_blacklisted_shaders() -> Result<Vec<String>, Error> {
    ApiEndpoints::norisk_blacklisted_shaders().await.map_err(|e| e.into())
}

#[tauri::command]
async fn get_blacklisted_datapacks() -> Result<Vec<String>, Error> {
    ApiEndpoints::norisk_blacklisted_datapacks()
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
async fn get_blacklisted_servers() -> Result<Vec<FeaturedServer>, Error> {
    ApiEndpoints::norisk_blacklisted_servers()
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
async fn search_mods(
    params: ModrinthSearchRequestParams,
) -> Result<ModrinthModsSearchResponse, Error> {
    ModrinthApiEndpoints::search_projects(&params, None).await
}

#[tauri::command]
async fn console_log_info(message: String) {
    log::info!("{}", message);
}

#[tauri::command]
async fn console_log_warning(message: String) {
    log::warn!("{}", message);
}

#[tauri::command]
async fn console_log_error(message: String) {
    log::error!("{}", message);
}

#[tauri::command]
async fn get_mod_info(slug: String) -> Result<ModInfo, Error> {
    ModrinthApiEndpoints::get_project::<ModInfo>(&slug).await
}

#[tauri::command]
async fn get_project_versions(slug: String, params: String) -> Result<Vec<ModrinthProject>, Error> {
    ModrinthApiEndpoints::get_project_version(&slug, &params).await
}

#[tauri::command]
async fn install_mod_and_dependencies(
    slug: &str,
    version: Option<&str>,
    params: &str,
    required_mods: Vec<LoaderMod>,
) -> Result<CustomMod, Error> {
    ModManager::install_mod_and_dependencies(slug, version, params, &required_mods).await
}

#[tauri::command]
async fn search_shaders(
    params: ModrinthSearchRequestParams,
) -> Result<ModrinthShadersSearchResponse, Error> {
    ModrinthApiEndpoints::search_projects(&params, None).await
}

#[tauri::command]
async fn get_shader_info(slug: String) -> Result<ShaderInfo, Error> {
    ModrinthApiEndpoints::get_project::<ShaderInfo>(&slug).await
}

#[tauri::command]
async fn get_shader(slug: &str, params: &str) -> Result<Shader, Error> {
    ShaderManager::get_shader(slug, params).await
}

#[tauri::command]
async fn download_shader(options: LauncherOptions, branch: &str, shader: Shader, window: Window) -> Result<(), Error> {
    ShaderManager::download_shader(options, branch, &shader, window).await
}

#[tauri::command]
async fn search_resourcepacks(
    params: ModrinthSearchRequestParams,
) -> Result<ModrinthResourcePacksSearchResponse, Error> {
    ModrinthApiEndpoints::search_projects(&params, None).await
}

#[tauri::command]
async fn get_resourcepack_info(slug: String) -> Result<ResourcePackInfo, Error> {
    ModrinthApiEndpoints::get_project::<ResourcePackInfo>(&slug).await
}

#[tauri::command]
async fn get_resourcepack(slug: &str, params: &str) -> Result<ResourcePack, Error> {
    ResourcePackManager::get_resourcepack(slug, params).await
}

#[tauri::command]
async fn download_resourcepack(options: LauncherOptions, branch: &str, resourcepack: ResourcePack, window: Window) -> Result<(), Error> {
    ResourcePackManager::download_resourcepack(options, branch, &resourcepack, window).await
}

#[tauri::command]
async fn search_datapacks(
    params: ModrinthSearchRequestParams,
) -> Result<ModrinthDatapacksSearchResponse, Error> {
    ModrinthApiEndpoints::search_projects(&params, Some(HashMap::from([("l".to_string(), "datapacks".to_string())]))).await
}

#[tauri::command]
async fn get_datapack_info(slug: String) -> Result<DatapackInfo, Error> {
    ModrinthApiEndpoints::get_project::<DatapackInfo>(&slug).await
}

#[tauri::command]
async fn get_datapack(slug: &str, params: &str, world: &str) -> Result<Datapack, Error> {
    DataPackManager::get_datapack(slug, params, world).await
}

#[tauri::command]
async fn download_datapack(options: LauncherOptions, branch: &str, world: &str, datapack: Datapack, window: Window) -> Result<(), Error> {
    DataPackManager::download_datapack(options, branch, world, &datapack, window).await
}

#[tauri::command]
async fn get_world_folders(options: LauncherOptions, branch: &str) -> Result<Vec<String>, Error> {
    DataPackManager::get_worlds(options, branch).await
}

#[tauri::command]
async fn unequip_cape(norisk_token: &str, uuid: &str) -> Result<(), String> {
    CapeApiEndpoints::unequip_cape(norisk_token, uuid).await
}

#[tauri::command]
async fn request_trending_capes(
    norisk_token: &str,
    uuid: &str,
    alltime: u32,
    limit: u32,
) -> Result<Vec<Cape>, String> {
    CapeApiEndpoints::request_trending_capes(norisk_token, uuid, alltime, limit)
        .await
        .map_err(|e| format!("unable to request trending capes: {:?}", e))
}

#[tauri::command]
async fn request_user_capes(
    norisk_token: &str,
    uuid: &str,
    username: &str,
) -> Result<Vec<Cape>, String> {
    CapeApiEndpoints::request_user_capes(norisk_token, uuid, username)
        .await
        .map_err(|e| format!("unable to request user capes: {:?}", e))
}

#[tauri::command]
async fn request_owned_capes(
    norisk_token: &str,
    uuid: &str,
) -> Result<Vec<Cape>, String> {
    CapeApiEndpoints::request_owned_capes(norisk_token, uuid)
        .await
        .map_err(|e| format!("unable to request owned capes: {:?}", e))
}

#[tauri::command]
async fn download_template_and_open_explorer() -> Result<(), String> {
    let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
        .await
        .unwrap_or_default();
    let template_url = if options.experimental_mode {
        "https://cdn.norisk.gg/capes-staging/template.png"
    } else {
        "https://cdn.norisk.gg/capes/template.png"
    };
    let user_dirs = UserDirs::new().unwrap();
    let downloads_dir = user_dirs.download_dir().unwrap();
    debug!("Downloads directory: {:?}", downloads_dir);
    let response = HTTP_CLIENT
        .get(template_url)
        .send()
        .await
        .map_err(|e| format!("Error downloading template: {:?}", e))?;
    let template_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Error reading template bytes: {:?}", e))?;

    let mut file = File::create(downloads_dir.join("nrc_cape_template.png"))
        .map_err(|e| format!("Error creating file: {:?}", e))?;
    file.write_all(&template_bytes)
        .map_err(|e| format!("Error writing file: {:?}", e))?;

    CapeApiEndpoints::show_in_folder(
        downloads_dir
            .join("nrc_cape_template.png")
            .into_os_string()
            .to_str()
            .unwrap(),
    );

    Ok(())
}

#[tauri::command]
async fn export_profile_and_open_explorer(profile_id: String) -> Result<(), String> {
    LauncherProfiles::export(profile_id).await
}

#[tauri::command]
async fn import_launcher_profile(file_location: &str) -> Result<(), String> {
    LauncherProfiles::import(file_location).await
}

#[tauri::command]
async fn get_mobile_app_token(norisk_token: &str, uuid: &str) -> Result<String, String> {
    ApiEndpoints::get_mcreal_app_token(norisk_token, uuid)
        .await
        .map_err(|e| format!("unable to get mcreal app token: {:?}", e))
}

#[tauri::command]
async fn reset_mobile_app_token(norisk_token: &str, uuid: &str) -> Result<String, String> {
    ApiEndpoints::reset_mcreal_app_token(norisk_token, uuid)
        .await
        .map_err(|e| format!("unable to reset mcreal app token: {:?}", e))
}

#[tauri::command]
pub async fn open_minecraft_logs_window(
    uuid: Uuid,
    is_live: bool,
    handle: tauri::AppHandle,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    // Hole die Runner-Instanzen
    let runner_instances = app_state.runner_instances.lock().unwrap();

    // Finde die Instanz, die der gegebenen UUID entspricht
    let instance = runner_instances
        .iter()
        .find(|instance| instance.id == uuid);

    // Berechne den Branch und die zugehörige Nummer
    let branch_with_number = if let Some(instance) = instance {
        // Filtere die Instanzen mit dem gleichen Branch-Namen
        let filtered: Vec<_> = runner_instances
            .iter()
            .filter(|inst| inst.branch == instance.branch)
            .collect();

        // Finde den Index der aktuellen Instanz innerhalb des gefilterten Arrays
        let index = filtered.iter().position(|inst| inst.id == uuid).unwrap_or(0);

        // Generiere den Namen mit der Nummer, wenn der Index > 0 ist
        if index > 0 {
            format!("{} ({})", instance.branch, index + 1)
        } else {
            instance.branch.clone()
        }
    } else {
        // Wenn keine Instanz gefunden wurde, verwende einen Standardwert
        "Unknown Branch (0)".to_string()
    };

    // Erstelle eine eindeutige Bezeichnung für das Fenster
    let random_number: u64 = rand::thread_rng().gen_range(100000..999999);
    let unique_label = format!("logs-{}:{}:{}", random_number, uuid, is_live);

    // Baue das Fenster
    let window = tauri::WindowBuilder::new(
        &handle,
        unique_label,
        tauri::WindowUrl::App("logs.html".into()),
    )
        .inner_size(1000.0, 800.0)
        .build()?;

    // Setze den Titel des Fensters mit dem Branch und der Nummer
    let _ = window.set_title(&format!("Minecraft Logs [{}]", branch_with_number));
    let _ = window.set_resizable(true);
    let _ = window.set_focus();

    Ok(())
}


#[tauri::command]
pub async fn open_minecraft_crash_window(
    handle: tauri::AppHandle,
    crash_report_path: String,
) -> Result<(), Error> {
    // Generate a random number
    let random_number: u64 = rand::thread_rng().gen_range(100000..999999);
    // Create a unique label using the random number
    let unique_label = format!("crash-{}", random_number);
    // Create the new window
    let window = tauri::WindowBuilder::new(
        &handle,
        unique_label,
        tauri::WindowUrl::App("crash.html".into()),
    )
        .build()?;

    // Set window properties
    let _ = window.set_title("Crash Report");
    let _ = window.set_resizable(true);
    let _ = window.set_focus();

    // we delay it so window has time to build hopefully this works lol
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    // Trigger an event to send the crash report path to the window
    window.emit("crash-report", crash_report_path)?;

    Ok(())
}

#[tauri::command]
pub async fn get_latest_minecraft_logs() -> Result<Vec<String>, Error> {
    let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
        .await
        .unwrap_or_default();
    let latest_branch = if options.experimental_mode {
        options.latest_dev_branch
    } else {
        options.latest_branch
    }
        .ok_or(ErrorKind::OtherError("No Latest Branch was found".to_string()).as_error())?;

    let log_path: PathBuf = LAUNCHER_DIRECTORY
        .data_dir()
        .join("gameDir")
        .join(latest_branch)
        .join("logs")
        .join("latest.log");

    if !log_path.exists() {
        return Err(ErrorKind::OtherError("Log file does not exist".to_string()).as_error());
    }

    let file = File::open(log_path)?;
    let reader = io::BufReader::new(file);
    let lines: Vec<String> = reader.lines().collect::<Result<_, _>>()?;

    Ok(lines)
}

#[tauri::command]
pub async fn read_txt_file(file_path: String) -> Result<Vec<String>, Error> {
    debug!("Incoming Path {:?}", file_path.clone());
    let normalized_path = file_path.trim().replace("\\", "/");
    let path = std::path::Path::new(&normalized_path);
    debug!("Normalized Path {:?}", normalized_path.clone());

    if !path.exists() {
        return Err(ErrorKind::OtherError(format!("File does not exist: {:?}", path)).as_error());
    }

    let file = File::open(path)?;
    let reader = io::BufReader::new(file);
    let lines: Vec<String> = reader.lines().collect::<Result<_, _>>()?;

    Ok(lines)
}

#[tauri::command]
async fn minecraft_auth_get_store() -> Result<MinecraftAuthStore, Error> {
    Ok(MinecraftAuthStore::init(None).await?)
}

#[tauri::command]
pub async fn minecraft_auth_remove_user(
    uuid: uuid::Uuid,
) -> Result<Option<Credentials>, Error> {
    Ok(minecraft_auth_get_store().await?.remove(uuid).await?)
}

#[tauri::command]
pub async fn minecraft_auth_get_default_user() -> Result<Option<Credentials>, Error> {
    let accounts = minecraft_auth_get_store().await?;
    let account = accounts.users.get(&accounts.default_user.ok_or(ErrorKind::NoCredentialsError)?).ok_or(ErrorKind::NoCredentialsError)?;
    Ok(Option::from(minecraft_auth_update_mojang_and_norisk_token(account.clone()).await?))
}

pub async fn refresh_norisk_token_if_necessary(credentials: Option<&Credentials>) -> Result<Option<Credentials>, crate::error::Error> {
    let experimental_mode = get_options().await?.experimental_mode;
    if credentials.is_some() {
        let token_result = credentials.unwrap().norisk_credentials.get_token(experimental_mode).await;
        match token_result {
            //TODO checken ob token valid ist (api mässig)
            Ok(token) => {
                let result = ApiEndpoints::get_norisk_user(&token, &credentials.unwrap().id.to_string()).await;
                match result {
                    Ok(_) => {
                        debug!("NoRisk Token is valid");
                    }
                    Err(error) => {
                        // Überprüfen, ob der Fehler ein HTTP-Fehler ist
                        debug!("Error Fetching NoRiskUser: {:?}",error);
                        //ich weiß ich weiß...
                        if error.to_string().contains("(401 Unauthorized)") {
                            info!("Refreshing NoRisk Token because: {}", error.to_string());
                            return Ok(Option::from(minecraft_auth_update_norisk_token(credentials.unwrap().clone()).await?));
                        }
                    }
                }
            }
            Err(error) => {
                // Versuche den NoRisk-Token zu aktualisieren
                info!("Refreshing NoRisk Token because: {}", error.to_string());
                return Ok(Option::from(minecraft_auth_update_norisk_token(credentials.unwrap().clone()).await?));
            }
        };
    }

    Ok(credentials.cloned())
}

#[tauri::command]
pub async fn minecraft_auth_set_default_user(uuid: uuid::Uuid) -> Result<(), Error> {
    let mut accounts = minecraft_auth_get_store().await?;
    accounts.default_user = Some(uuid);
    accounts.save().await?;
    Ok(())
}

/// Get a copy of the list of all user credentials
// invoke('plugin:auth|auth_users',user)
#[tauri::command]
pub async fn minecraft_auth_users() -> Result<Vec<Credentials>, Error> {
    let accounts = minecraft_auth_get_store().await?;
    Ok(accounts.users.values().cloned().collect())
}

#[tauri::command]
pub async fn minecraft_auth_update_norisk_token(
    credentials: Credentials,
) -> Result<Credentials, Error> {
    let mut accounts = minecraft_auth_get_store().await?;
    Ok(accounts.refresh_norisk_token_if_necessary(&credentials, false).await?)
}

#[tauri::command]
pub async fn minecraft_auth_update_mojang_and_norisk_token(
    credentials: Credentials,
) -> Result<Credentials, Error> {
    return Ok(minecraft_auth_get_store()
        .await?
        .update_norisk_and_microsoft_token(&credentials)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?);
}

#[tauri::command]
pub async fn get_options() -> Result<LauncherOptions, crate::error::Error> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    Ok(LauncherOptions::load(config_dir).await.unwrap_or_default()) // default to basic options if unable to load
}

#[tauri::command]
async fn get_launcher_profiles() -> Result<LauncherProfiles, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    Ok(LauncherProfiles::load(config_dir).await.unwrap_or_default()) // default to basic launcher_profiles defaults if unable to load
}

#[tauri::command]
async fn get_custom_mods_filenames(
    options: LauncherOptions,
    profile_id: &str,
) -> Result<Vec<String>, Error> {
    ModManager::get_custom_mods_filenames(options, profile_id).await
}

#[tauri::command]
async fn save_custom_mod_to_folder(
    options: LauncherOptions,
    profile_id: &str,
    file: FileData,
) -> Result<(), Error> {
    ModManager::save_custom_mod_to_folder(options, profile_id, file).await
}

#[tauri::command]
async fn delete_custom_mod_file(
    options: LauncherOptions,
    profile_id: &str,
    file: &str,
) -> Result<(), Error> {
    ModManager::delete_custom_mod_file(options, profile_id, file).await
}

#[tauri::command]
async fn get_custom_shaders_filenames(
    options: LauncherOptions,
    branch: &str,
    installed_shaders: Vec<Shader>,
) -> Result<Vec<String>, Error> {
    ShaderManager::get_custom_shaders_filenames(options, branch, installed_shaders).await
}

#[tauri::command]
async fn get_custom_shaders_folder(
    options: LauncherOptions,
    branch: &str,
) -> Result<String, Error> {
    Ok(ShaderManager::get_shaders_folder(options, branch).to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_shader_file(
    file_name: &str,
    options: LauncherOptions,
    branch: &str,
) -> Result<(), Error> {
    ShaderManager::delete_shader_file(options, branch, file_name).await
}

#[tauri::command]
async fn save_custom_shader_to_folder(
    options: LauncherOptions,
    branch: &str,
    file: FileData,
) -> Result<(), Error> {
    ShaderManager::save_custom_shader_to_folder(options, branch, file).await
}

#[tauri::command]
async fn get_custom_resourcepacks_filenames(
    options: LauncherOptions,
    branch: &str,
    installed_resourcepacks: Vec<ResourcePack>,
) -> Result<Vec<String>, Error> {
    ResourcePackManager::get_custom_resourcepack_filenames(options, branch, installed_resourcepacks).await
}

#[tauri::command]
async fn get_custom_resourcepacks_folder(
    options: LauncherOptions,
    branch: &str,
) -> Result<String, Error> {
    Ok(ResourcePackManager::get_resourcepack_folder(options, branch).to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_resourcepack_file(
    options: LauncherOptions,
    branch: &str,
    file_name: &str,
) -> Result<(), Error> {
    ResourcePackManager::delete_resourcepack_file(options, branch, file_name).await
}

#[tauri::command]
async fn save_custom_resourcepack_to_folder(
    options: LauncherOptions,
    branch: &str,
    file: FileData,
) -> Result<(), Error> {
    ResourcePackManager::save_custom_resourcepack_to_folder(options, branch, file).await
}

#[tauri::command]
async fn get_custom_datapacks_filenames(
    options: LauncherOptions,
    branch: &str,
    world: &str,
    installed_datapacks: Vec<Datapack>,
) -> Result<Vec<String>, Error> {
    DataPackManager::get_custom_datapack_filenames(options, branch, world, installed_datapacks).await
}

#[tauri::command]
async fn get_custom_datapacks_folder(
    options: LauncherOptions,
    branch: &str,
    world: &str,
) -> Result<String, Error> {
    Ok(DataPackManager::get_datapack_folder(options, branch, world).to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_datapack_file(
    options: LauncherOptions,
    branch: &str,
    world: &str,
    file_name: &str,
) -> Result<(), Error> {
    DataPackManager::delete_datapack_file(options, branch, world, file_name).await
}

#[tauri::command]
async fn save_custom_datapack_to_folder(
    options: LauncherOptions,
    branch: &str,
    world: &str,
    file: FileData,
) -> Result<(), Error> {
    DataPackManager::save_custom_datapack_to_folder(options, branch, world, file).await
}

#[tauri::command]
async fn enable_keep_local_assets() -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();

    let file = config_dir.join("keepLocalAssets");

    if !file.exists() {
        info!("Creating keepLocalAssets file: {:?}", file);
        let content = "Hi, what are you doing here?\nMsg me on discord (aim_shock) for a free cookie!\n\nBye <3";
        fs::write(&file, Vec::from(content))
            .await
            .map_err(|e| format!("unable to create keepLocalAssets file: {:?}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn disable_keep_local_assets() -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();

    let file = config_dir.join("keepLocalAssets");

    if file.exists() {
        info!("Removing keepLocalAssets file: {:?}", file);
        fs::remove_file(&file)
            .await
            .map_err(|e| format!("unable to remove keepLocalAssets file: {:?}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_keep_local_assets() -> Result<bool, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();

    let file = config_dir.join("keepLocalAssets");

    Ok(file.exists())
}

#[tauri::command]
async fn get_player_skins(uuid: String) -> Result<Vec<String>, String> {
    let minecraft_profile: Result<MinecraftProfile, reqwest::Error> = HTTP_CLIENT
        .get(format!(
            "https://sessionserver.mojang.com/session/minecraft/profile/{}",
            uuid
        ))
        .send()
        .await
        .map_err(|e| format!("unable to connect to sessionserver.mojang.com: {:}", e))?
        .error_for_status()
        .map_err(|e| format!("sessionserver.mojang.com returned an error: {:}", e))?
        .json()
        .await;

    match minecraft_profile {
        Ok(profile) => {
            let mut textures: Vec<String> = vec![];
            for property in profile.properties.iter() {
                if property.name == "textures" {
                    textures.push(property.value.clone())
                }
            }
            Ok(textures)
        }
        Err(_) => Err("Failed to retrieve Minecraft profile".to_string()), // You can provide a custom error message here.
    }
}

#[tauri::command]
async fn save_player_skin(
    location: String,
    slim: bool,
    access_token: String,
) -> Result<(), String> {
    let file_data = match tokio::fs::read(&location).await {
        Ok(data) => data,
        Err(e) => return Err(e.to_string()),
    };

    let part = Part::bytes(file_data).file_name("skin.png");

    let response = HTTP_CLIENT
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(access_token)
        .multipart(
            Form::new()
                .text("variant", if slim { "slim" } else { "classic" })
                .part("file", part),
        )
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        info!("Skin {} saved successfully.", &location);
        Ok(())
    } else {
        Err(format!(
            "Failed to save the new skin. Status code: {}",
            response.status()
        ))
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
        }
        Err(err) => Err(format!("Failed to open the file: {}", err)),
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
    options
        .store(config_dir)
        .await
        .map_err(|e| format!("unable to store config data: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn store_launcher_profiles(launcher_profiles: LauncherProfiles) -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    launcher_profiles
        .store(config_dir)
        .await
        .map_err(|e| format!("unable to store launcher_profiles data: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_norisk_user(
    options: LauncherOptions,
    credentials: Credentials,
) -> Result<NoRiskUserMinimal, crate::error::Error> {
    let user = ApiEndpoints::get_norisk_user(
        &credentials
            .norisk_credentials
            .get_token(options.experimental_mode)
            .await?,
        &credentials.id.to_string(),
    ).await?;

    // ensure user does not have keepLocalAssets enabled depending on rank
    let allowed_ranks = vec![
        "ADMIN".to_string(),
        "DEVELOPER".to_string(),
        "DESIGNER".to_string(),
    ];
    if !allowed_ranks.contains(&user.rank) {
        disable_keep_local_assets().await.map_err(|e| ErrorKind::LauncherError(format!("Disable Keep Local Assets: {:?}", e)).as_error())?;
    }
    Ok(user)
}

#[tauri::command]
async fn check_maintenance_mode() -> Result<bool, String> {
    let maintenance_mode = ApiEndpoints::norisk_maintenance_mode()
        .await
        .map_err(|e| format!("unable to request maintenance mode: {:?}", e))?;
    Ok(maintenance_mode)
}

#[tauri::command]
async fn request_norisk_branches(
    options: LauncherOptions,
    credentials: Credentials,
) -> Result<Vec<String>, Error> {
    Ok(NRCCache::get_branches(options, credentials).await?)
}

#[tauri::command]
async fn enable_experimental_mode(credentials: Credentials) -> Result<String, String> {
    // This requires the production token to be present!!!
    return ApiEndpoints::enable_experimental_mode(
        &credentials.norisk_credentials.production.unwrap().value,
        &credentials.id.to_string(),
    )
        .await
        .map_err(|e| format!("unable to enable experimental mode: {:?}", e));
}

#[tauri::command]
async fn get_launch_manifest(branch: &str, norisk_token: &str, uuid: Uuid) -> Result<NoRiskLaunchManifest, Error> {
    Ok(NRCCache::get_launch_manifest(branch, norisk_token, uuid).await?)
}

#[tauri::command]
async fn upload_logs(log: String) -> Result<McLogsUploadResponse, String> {
    let log_response = McLogsApiEndpoints::upload_logs(log)
        .await
        .map_err(|e| format!("unable to upload logs: {:?}", e))?;
    Ok(log_response)
}

#[tauri::command]
async fn discord_auth_link(
    options: LauncherOptions,
    credentials: Credentials,
    app: tauri::AppHandle,
) -> Result<(), Error> {
    let token = credentials
        .norisk_credentials
        .get_token(options.experimental_mode)
        .await?;
    let url = format!(
        "https://api{}.norisk.gg/api/v1/core/oauth/discord?token={}",
        if options.experimental_mode.clone() {
            "-staging"
        } else {
            ""
        },
        token
    );

    if let Some(window) = app.get_window("discord-signin") {
        window.close()?;
    }

    let start = Utc::now();

    let window = tauri::WindowBuilder::new(
        &app,
        "discord-signin",
        tauri::WindowUrl::External(url.parse().unwrap()),
    )
        .title("Discord X NoRiskClient")
        .always_on_top(true)
        .center()
        .max_inner_size(1250.0, 1000.0)
        .build()?;

    window.request_user_attention(Some(UserAttentionType::Critical))?;

    while (Utc::now() - start) < chrono::Duration::minutes(10) {
        if window.title().is_err() {
            // user closed window, cancelling flow
            return Ok(());
        }

        if window
            .url()
            .as_str()
            .starts_with("https://api.norisk.gg/api/v1/core/oauth/discord/complete")
        {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            window.close()?;
            return Ok(());
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    window.close()?;
    Ok(())
}

#[tauri::command]
async fn discord_auth_status(
    options: LauncherOptions,
    credentials: Credentials,
) -> Result<bool, Error> {
    Ok(ApiEndpoints::discord_link_status(
        &credentials
            .norisk_credentials
            .get_token(options.experimental_mode)
            .await?,
        &credentials.id.to_string(),
    )
        .await?)
}

#[tauri::command]
async fn discord_auth_unlink(
    credentials: Credentials,
    options: LauncherOptions,
) -> Result<(), Error> {
    ApiEndpoints::unlink_discord(
        &credentials
            .norisk_credentials
            .get_token(options.experimental_mode)
            .await?,
        &credentials.id.to_string(),
    )
        .await?;
    Ok(())
}

#[tauri::command]
async fn microsoft_auth(app: tauri::AppHandle) -> Result<Option<Credentials>, Error> {
    let mut accounts = MinecraftAuthStore::init(None).await?;

    let flow = accounts.login_begin().await?;

    let start = Utc::now();

    if let Some(window) = app.get_window("signin") {
        window.close()?;
    }

    let window = tauri::WindowBuilder::new(
        &app,
        "signin",
        tauri::WindowUrl::External(flow.redirect_uri.parse().map_err(|_| {
            ErrorKind::OtherError("Error parsing auth redirect URL".to_string())
                .as_error()
        })?),
    )
        .title("Sign into NoRiskClient")
        .always_on_top(true)
        .center()
        .build()?;

    window.request_user_attention(Some(UserAttentionType::Critical))?;

    while (Utc::now() - start) < chrono::Duration::minutes(10) {
        if window.title().is_err() {
            // user closed window, cancelling flow
            return Ok(None);
        }

        if window
            .url()
            .as_str()
            .starts_with("https://login.live.com/oauth20_desktop.srf")
        {
            if let Some((_, code)) = window.url().query_pairs().find(|x| x.0 == "code") {
                window.close()?;
                let credentials = accounts
                    .login_finish(&code.clone(), flow, app.get_window("main").unwrap())
                    .await?;

                app.get_window("main")
                    .unwrap()
                    .emit("microsoft-output", "signIn.step.noriskToken")
                    .unwrap_or_default();
                match accounts.refresh_norisk_token_if_necessary(&credentials.clone(), true).await {
                    Ok(credentials_with_norisk) => {
                        debug!("After Microsoft Auth: Successfully received NoRiskClient Token");
                        return Ok(Some(credentials_with_norisk));
                    }
                    Err(err) => {
                        //Ist uns aber egal Microsoft Auth hat geklappt
                        debug!(
                            "After Microsoft Auth: Error Fetching NoRiskClient Token {:?}",
                            err
                        );
                        app.get_window("main")
                            .unwrap()
                            .emit("microsoft-output", "signIn.step.notWhitelisted")
                            .unwrap_or_default();
                    }
                }

                return Ok(Some(credentials.clone()));
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    window.close()?;
    Ok(None)
}

fn handle_stdout(window: &Arc<Mutex<Window>>, data: &[u8], uuid: Uuid) -> anyhow::Result<()> {
    let data = String::from_utf8(data.to_vec())?;
    if data.is_empty() {
        return Ok(()); // ignore empty lines
    }

    info!("{}", data.trim());

    // Regex to detect the crash message and extract the file path
    let crash_regex =
        Regex::new(r"#@!@# Game crashed! Crash report saved to: #@!@# (?P<path>.+)").unwrap();

    // Check if the data contains a crash report
    if let Some(captures) = crash_regex.captures(&data) {
        if let Some(crash_path) = captures.name("path") {
            let crash_path_str = crash_path.as_str();
            info!("Game crashed! Crash report located at: {}", crash_path_str);

            // Use the show_in_folder method to open the file in the system's file explorer
            //CapeApiEndpoints::show_in_folder(crash_path_str);

            // Emit an event with the crash path to the front-end
            window
                .lock()
                .unwrap()
                .emit("minecraft-crash", crash_path_str)?;
        }
    } else {
        // Emit the regular process output
        window.lock().unwrap().emit("process-output", OutputData {
            id: uuid,
            text: data,
        })?;
    }
    Ok(())
}

fn handle_stderr(window: &Arc<std::sync::Mutex<Window>>, data: &[u8], uuid: Uuid) -> anyhow::Result<()> {
    let data = String::from_utf8(data.to_vec())?;
    if data.is_empty() {
        return Ok(()); // ignore empty lines
    }

    error!("{}", data.trim());
    window.lock().unwrap().emit("process-output", OutputData {
        id: uuid,
        text: data,
    })?;
    Ok(())
}

fn handle_progress(
    window: &Arc<std::sync::Mutex<Window>>,
    progress_update: ProgressUpdate,
    instance_id: Uuid,
    instances: Arc<Mutex<Vec<RunnerInstance>>>,
) -> anyhow::Result<()> {
    if let Some(instance) = instances.lock().unwrap().iter_mut().find(|r| r.id == instance_id) {
        instance.progress_updates.push(progress_update.clone());
        // Ensure the list does not exceed 10 entries
        if instance.progress_updates.len() > 10 {
            instance.progress_updates.remove(0);
        }
    }
    window
        .lock()
        .unwrap()
        .emit("progress-update", ClientProgressUpdate { instance_id: instance_id.clone(), data: progress_update })?;
    Ok(())
}

#[tauri::command]
async fn get_last_viewed_popups() -> Result<LastViewedPopups, String> {
    let last_viewed_popups = LastViewedPopups::load(LAUNCHER_DIRECTORY.config_dir())
        .await
        .unwrap_or_default();
    Ok(last_viewed_popups)
}

#[tauri::command]
async fn store_last_viewed_popups(last_viewed_popups: LastViewedPopups) -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    last_viewed_popups
        .store(config_dir)
        .await
        .map_err(|e| format!("unable to store last viewed popups data: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_changelogs() -> Result<Vec<ChangeLog>, String> {
    ApiEndpoints::changelogs()
        .await
        .map_err(|e| format!("unable to get changelogs: {:?}", e))
}

#[tauri::command]
async fn get_announcements() -> Result<Vec<Announcement>, String> {
    ApiEndpoints::announcements()
        .await
        .map_err(|e| format!("unable to get announcements: {:?}", e))
}

#[tauri::command]
async fn check_for_new_branch(branch: &str) -> Result<Option<bool>, String> {
    let options = get_options()
        .await
        .map_err(|e| format!("unable to load options: {:?}", e))?;
    let game_dir_path = options.data_path_buf().join("gameDir");
    if !game_dir_path.exists() {
        return Ok(None);
    }

    let all_branches = game_dir_path
        .read_dir()
        .map_err(|e| format!("unable to read branches: {:?}", e))?
        .filter(|entry| {
            entry
                .as_ref()
                .map(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .unwrap_or(false)
        })
        .map(|entry| entry.map(|e| e.file_name().into_string().unwrap()))
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("unable to read branches: {:?}", e))?;
    if all_branches.len() <= 0 {
        return Ok(None);
    }

    let branch_path = game_dir_path.join(branch);

    Ok(Some(!branch_path.exists()))
}

#[tauri::command]
async fn get_branches_from_folder() -> Result<Vec<String>, String> {
    let options = get_options()
        .await
        .map_err(|e| format!("unable to load options: {:?}", e))?;
    let game_dir_path = options.data_path_buf().join("gameDir");
    if !game_dir_path.exists() {
        return Ok(Vec::new());
    }

    let branches = game_dir_path
        .read_dir()
        .map_err(|e| format!("unable to read branches: {:?}", e))?
        .filter(|entry| {
            entry
                .as_ref()
                .map(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                .unwrap_or(false)
        })
        .map(|entry| entry.map(|e| e.file_name().into_string().unwrap()))
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("unable to read branches: {:?}", e))?;

    Ok(branches)
}

#[tauri::command]
async fn get_default_mc_folder() -> Result<String, String> {
    if let Some(appdata_dir) = data_dir() {
        let minecraft_folder = if cfg!(target_os = "macos") {
            appdata_dir.join("minecraft")
        } else {
            appdata_dir.join(".minecraft")
        };
        Ok(minecraft_folder.as_os_str().to_str().unwrap().to_string())
    } else {
        Err("Unable to find default Minecraft folder".to_string())
    }
}

#[tauri::command]
async fn copy_mc_data(path: &str, branch: &str, app: tauri::AppHandle) -> Result<(), String> {
    McDataHandler::copy_mc_data(path, branch, app).await
}

#[tauri::command]
async fn get_running_instances(app_state: tauri::State<'_, AppState>) -> Result<Vec<RunnerInstance>, crate::error::Error> {
    Ok(NRCCache::get_running_instances(app_state).await?)
}

#[tauri::command]
async fn copy_branch_data(
    old_branch: &str,
    new_branch: &str,
    app: tauri::AppHandle,
) -> Result<(), String> {
    McDataHandler::copy_branch_data(old_branch, new_branch, app).await
}

#[tauri::command]
async fn run_client(
    branch: String,
    options: LauncherOptions,
    force_server: Option<String>,
    mods: Vec<LoaderMod>,
    window: Window,
    app_state: tauri::State<'_, AppState>
) -> Result<Uuid, Error> {
    debug!("Starting Client with branch {}", branch);
    fs::create_dir_all(&LAUNCHER_DIRECTORY.data_dir().join("nrc_cache")).await?;

    let mut accounts = minecraft_auth_get_store().await?;

    let credentials = match accounts
        .get_default_credential()
        .await {
        Ok(creds) => { creds }
        Err(_) => {
            Option::from(accounts.users.get(&accounts.default_user.ok_or(ErrorKind::NoCredentialsError)?).ok_or(ErrorKind::NoCredentialsError)?.clone())
        }
    }.ok_or(ErrorKind::NoCredentialsError)?;

    debug!("Starting Minecraft with Account {:?}", credentials.username);

    let window_mutex = Arc::new(std::sync::Mutex::new(window));

    let parameters = LaunchingParameter {
        dev_mode: options.experimental_mode,
        force_server: force_server,
        memory: options.memory_limit,
        data_path: options.data_path_buf(),
        custom_java_path: if !options.custom_java_path.is_empty() {
            Some(options.custom_java_path)
        } else {
            None
        },
        custom_java_args: options.custom_java_args,
        auth_player_name: credentials.username,
        auth_uuid: credentials.id.to_string(),
        auth_access_token: credentials.access_token,
        auth_xuid: "x".to_string(),
        clientid: auth::AZURE_CLIENT_ID.to_string(),
        user_type: "msa".to_string(),
        keep_launcher_open: options.keep_launcher_open,
        concurrent_downloads: options.concurrent_downloads,
    };

    let token = if options.experimental_mode {
        credentials
            .norisk_credentials
            .experimental
            .ok_or(ErrorKind::NoCredentialsError)?
            .value
    } else {
        credentials
            .norisk_credentials
            .production
            .ok_or(ErrorKind::NoCredentialsError)?
            .value
    };

    info!("Loading launch manifest...");
    let launch_manifest = get_launch_manifest(&branch, &token, credentials.id).await?;

    let (terminator_tx, terminator_rx) = tokio::sync::oneshot::channel();
    let runner_id = Uuid::new_v4(); // Erzeuge eine neue UUID für die Instanz

    let runner_instances = Arc::clone(&app_state.runner_instances); // Verwende Arc für die Zustandsverwaltung
    runner_instances.lock().unwrap().push(RunnerInstance {
        terminator: Some(terminator_tx),
        id: runner_id.clone(), // Speichern der ID
        progress_updates: Vec::new(),
        p_id: None,
        is_attached: true,
        branch: branch.clone(),
    });

    thread::spawn(move || {
        let runner_instances = runner_instances.clone(); // Der Zustand ist jetzt für den Thread verfügbar

        let is_first_instance_of_branch = !runner_instances.lock().unwrap().iter().filter(|instance| {
            return instance.id != runner_id;
        }).any(|instance| {
            return instance.branch == branch;
        });

        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let keep_launcher_open = parameters.keep_launcher_open;

                if let Err(e) = prelauncher::launch(
                    options.multiple_instances || is_first_instance_of_branch,
                    &token,
                    &credentials.id.to_string(),
                    launch_manifest,
                    parameters,
                    mods,
                    LauncherData {
                        instance_id: runner_id,
                        instances: runner_instances.clone(),
                        on_stdout: handle_stdout,
                        on_stderr: handle_stderr,
                        on_progress: handle_progress,
                        data: Box::new(window_mutex.clone()),
                        terminator: terminator_rx,
                    },
                    window_mutex.clone(),
                    runner_id.clone(),
                )
                    .await
                {
                    if !keep_launcher_open {
                        window_mutex.lock().unwrap().show().unwrap();
                    }

                    window_mutex
                        .lock()
                        .unwrap()
                        .emit("client-error", format!("Failed to launch client: {:?}", e))
                        .unwrap();
                    handle_stderr(
                        &window_mutex,
                        format!("Failed to launch client: {:?}", e).as_bytes(),
                        runner_id,
                    )
                        .unwrap();
                }

                // Entferne die Instanz aus der Liste, wenn der Client geschlossen wurde
                let mut mut_runner_instances = runner_instances.lock().unwrap();

                // Suchen der Instanz anhand der ID
                if let Some(pos) = mut_runner_instances.iter().position(|r| r.id == runner_id) {
                    mut_runner_instances.remove(pos); // Entfernen der Instanz
                    debug!("Removed runner instance with id: {}", runner_id);
                }

                window_mutex
                    .lock()
                    .unwrap()
                    .emit("client-exited", ())
                    .unwrap();
            });
    });

    Ok(runner_id)
}

#[tauri::command]
async fn quit_everything() -> Result<(), crate::error::Error> {
    let pid = NRCCache::get_pid();
    let mut system = System::new_all();
    system.refresh_all(); // Alle Prozesse aktualisieren

    if let Some(game_process) = system.process(Pid::from(pid as usize)) {
        if game_process.name().contains("NoRiskClient") {
            info!("Killing noriskclient process with pid: {} and name: {}",pid,game_process.name());
            let _ = game_process.kill();
            info!("NoRiskClient process killed");
            return Ok(());
        } else {
            info!("Game process with pid: {} is not a NoRiskClient process.", pid);
        }
    } else {
        info!("No running NoRiskClient process found with pid: {}", pid);
    }
    Ok(())
}

#[tauri::command]
async fn terminate(instance_id: Uuid, app_state: tauri::State<'_, AppState>) -> Result<(), crate::error::Error> {
    let mut runner_instances = app_state.runner_instances.lock().unwrap();

    // Suchen nach der Instanz mit der gegebenen ID
    if let Some(instance_position) = runner_instances.iter_mut().position(|r| r.id == instance_id) {
        let instance = &mut runner_instances[instance_position];

        // Falls ein Terminator existiert, schließen wir das Spiel damit
        if let Some(terminator) = instance.terminator.take() {
            info!("Closing Game {:?}...", instance_id);
            terminator.send(()).map_err(|e| {
                OtherError(format!("Couldn't close Game {:?}", e).to_string()).as_error()
            })?;
            info!("Closed Game {:?}!", instance_id);
            return Ok(());
        }

        // Falls eine PID existiert, suchen wir den zugehörigen Prozess und beenden ihn
        if let Some(pid) = instance.p_id {
            let mut system = System::new_all();
            system.refresh_all(); // Alle Prozesse aktualisieren

            if let Some(game_process) = system.process(Pid::from(pid as usize)) {
                // Überprüfen, ob der Prozess "java" im Namen enthält
                if game_process.name().contains("java") {
                    info!("Killing game process with pid: {} and name: {}",pid,game_process.name());
                    let _ = game_process.kill();
                    info!("Game process killed");
                    runner_instances.remove(instance_position);
                    return Ok(());
                } else {
                    info!("Game process with pid: {} is not a Java process.", pid);
                }
            } else {
                info!("No running process found with pid: {}", pid);
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_total_memory() -> Result<u64, String> {
    Ok(total_memory())
}

#[tauri::command]
async fn refresh_via_norisk(login_data: LoginData) -> Result<LoginData, String> {
    let account = login_data
        .refresh_maybe_fixed()
        .await
        .map_err(|e| format!("unable to refresh: {:?}", e))?;
    Ok(account)
}

#[tauri::command]
async fn mc_name_by_uuid(uuid: &str) -> Result<String, String> {
    CapeApiEndpoints::mc_name_by_uuid(uuid)
        .await
        .map_err(|e| format!("unable get mc name by uuid: {:?}", e))
}

#[tauri::command]
async fn get_cape_hash_by_uuid(uuid: &str) -> Result<String, String> {
    CapeApiEndpoints::cape_hash_by_uuid(uuid)
        .await
        .map_err(|e| format!("unable get cape hash by uuid: {:?}", e))
}

#[tauri::command]
async fn get_whitelist_slots(norisk_token: &str, uuid: &str) -> Result<WhitelistSlots, String> {
    ApiEndpoints::whitelist_slots(norisk_token, uuid)
        .await
        .map_err(|e| format!("unable to get whitelist slots: {:?}", e))
}

#[tauri::command]
async fn add_player_to_whitelist(
    identifier: &str,
    norisk_token: &str,
    request_uuid: &str,
) -> Result<bool, String> {
    let response = HTTP_CLIENT
        .get(format!(
            "https://playerdb.co/api/player/minecraft/{}",
            identifier
        ))
        .send()
        .await
        .map_err(|e| format!("invalid username: {:}", e))
        .unwrap();
    let response_text = response.json::<PlayerDBData>().await.unwrap();
    let uuid = match response_text.data.player {
        Some(player) => player.id,
        None => return Err("invalid username / uuid".to_string()),
    };
    ApiEndpoints::whitelist_add_user(&uuid, norisk_token, request_uuid)
        .await
        .map_err(|e| format!("unable to add player to whitelist: {:?}", e))
}

#[tauri::command]
async fn default_data_folder_path() -> Result<String, String> {
    let data_directory = LAUNCHER_DIRECTORY.data_dir().to_str();

    match data_directory {
        Some(path) => Ok(path.to_string()),
        None => Err("unable to get data folder path".to_string()),
    }
}

#[tauri::command]
async fn clear_cache() -> Result<(), Error> {
    let options = get_options().await?;
    let auth_store = MinecraftAuthStore::init(Some(true)).await?;
    auth_store.save().await?;

    let _ = store_options(LauncherOptions::default()).await;
    let _ = store_launcher_profiles(LauncherProfiles::default()).await;

    [
        "assets",
        "libraries",
        "mod_cache",
        "nrc_cache",
        "custom_mods",
        "natives",
        "runtimes",
        "versions",
    ]
        .iter()
        .map(|dir| options.data_path_buf().join(dir))
        .filter(|dir| dir.exists())
        .map(std::fs::remove_dir_all)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| ErrorKind::OtherError(format!("unable to clear cache: {:?}", e)))?;

    Ok(())
}

///
/// Custom Servers
///
#[tauri::command]
async fn get_featured_servers(branch: &str) -> Result<Vec<FeaturedServer>, String> {
    ApiEndpoints::norisk_featured_servers(branch)
        .await
        .map_err(|e| format!("unable to get featured servers {:?}", e))
}

#[tauri::command]
async fn get_custom_servers(token: &str, uuid: &str) -> Result<CustomServersResponse, String> {
    ApiEndpoints::norisk_custom_servers(token, uuid).await.map_err(|e| format!("unable to get custom servers {:?}", e))
}

#[tauri::command]
async fn check_custom_server_subdomain(
    subdomain: &str,
    token: &str,
    uuid: &str,
) -> Result<bool, String> {
    ApiEndpoints::norisk_check_custom_server_subdomain(subdomain, token, uuid)
        .await
        .map_err(|e| format!("unable to check custom server subdomain {:?}", e))
}

#[tauri::command]
async fn get_custom_server_jwt_token(
    custom_server_id: &str,
    token: &str,
    uuid: &str,
) -> Result<String, String> {
    ApiEndpoints::norisk_get_custom_server_jwt_token(custom_server_id, token, uuid)
        .await
        .map_err(|e| format!("unable to get custom server jwt token: {:?}", e))
}

#[tauri::command]
async fn create_custom_server(
    name: &str,
    mc_version: &str,
    loader_version: Option<&str>,
    r#type: &str,
    subdomain: &str,
    token: &str,
    uuid: &str,
) -> Result<CustomServer, String> {
    ApiEndpoints::norisk_create_custom_server(
        name,
        mc_version,
        loader_version,
        r#type,
        subdomain,
        token,
        uuid,
    )
        .await
        .map_err(|e| format!("unable to create custom server: {:?}", e))
}

#[tauri::command]
async fn initialize_custom_server(
    custom_server: CustomServer,
    additional_data: Option<&str>,
    window: Window,
) -> Result<(), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window));
    CustomServerManager::initialize_server(&window_mutex, custom_server, additional_data)
        .await
        .map_err(|e| format!("unable to initialize custom server: {:?}", e))
}

#[tauri::command]
async fn run_custom_server(
    custom_server: CustomServer,
    options: LauncherOptions,
    token: String,
    window: Window,
) -> Result<(), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window.clone()));

    thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                CustomServerManager::run_server(
                    custom_server,
                    &options,
                    token,
                    window_mutex.clone(),
                )
                    .await
                    .unwrap();
                window_mutex
                    .lock()
                    .unwrap()
                    .emit("server-exited", ())
                    .unwrap();
                terminate_custom_server(false, window).await.unwrap();
                info!("Server exited!");
            });
    });
    Ok(())
}

#[tauri::command]
async fn check_if_custom_server_running(window: Window) -> Result<(bool, String), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window));

    let latest_running_server = CustomServerManager::load_latest_running_server()
        .await
        .unwrap_or_default();
    if latest_running_server.forwarder_process_id.is_none()
        && latest_running_server.process_id.is_none()
    {
        return Ok((false, String::new()));
    }

    let mut system = System::new_all();
    system.refresh_all();
    // check if process is still running
    let custom_server_process =
        system.process(Pid::from(latest_running_server.process_id.unwrap() as usize));
    match custom_server_process.is_some() {
        true => {
            info!("Custom server is already / still running!");
            CustomServerManager::read_and_process_server_log_file(
                &window_mutex,
                &latest_running_server.server_id.clone().unwrap(),
            )
                .await
                .unwrap();
            Ok((true, latest_running_server.server_id.unwrap()))
        }
        false => {
            info!("No custom server is running!");
            if latest_running_server.forwarder_process_id.is_some() {
                let custom_server_forwarder_process = system.process(Pid::from(
                    latest_running_server.forwarder_process_id.unwrap() as usize,
                ));
                if custom_server_forwarder_process.is_some() {
                    custom_server_forwarder_process.unwrap().kill();
                }
            }
            CustomServerManager::store_latest_running_server(None, None, None)
                .await
                .unwrap();
            Ok((false, String::new()))
        }
    }
}

#[tauri::command]
pub async fn terminate_custom_server(
    launcher_was_closed: bool,
    window: Window,
) -> Result<(), String> {
    let latest_running_server = CustomServerManager::load_latest_running_server()
        .await
        .unwrap();

    let mut system = System::new_all();
    system.refresh_all();

    info!("Killing Forwarding Manager");
    let custom_server_forwarder_process = system.process(Pid::from(
        latest_running_server.forwarder_process_id.unwrap() as usize,
    ));
    if custom_server_forwarder_process.is_some() {
        custom_server_forwarder_process.unwrap().kill();
    }

    info!("Killing Custom Server");
    let custom_server_process =
        system.process(Pid::from(latest_running_server.process_id.unwrap() as usize));
    if custom_server_process.is_some() {
        // Create a new client and connect to the server.
        let mut client = Client::new("127.0.0.1:25594".to_string()).unwrap();
        client.authenticate("minecraft".to_string()).unwrap();
        client.send_command("stop".to_string()).unwrap();
    }

    if launcher_was_closed {
        window
            .emit(
                "custom-server-process-output",
                CustomServerEventPayload {
                    server_id: latest_running_server.server_id.clone().unwrap(),
                    data: String::from("Stopping server"),
                },
            )
            .map_err(|e| format!("Failed to emit custom-server-process-output: {}", e))
            .unwrap();
        window
            .emit(
                "custom-server-process-output",
                CustomServerEventPayload {
                    server_id: latest_running_server.server_id.clone().unwrap(),
                    data: String::from("Thread RCON Listener stopped"),
                },
            )
            .map_err(|e| format!("Failed to emit custom-server-process-output: {}", e))
            .unwrap();
    }

    CustomServerManager::store_latest_running_server(None, None, None)
        .await
        .unwrap();

    Ok(())
}

#[tauri::command]
async fn execute_rcon_command(
    server_id: String,
    timestamp: String,
    log_type: String,
    command: String,
    window: Window,
) -> Result<String, String> {
    let mut client = Client::new("127.0.0.1:25594".to_string()).unwrap();
    client.authenticate("minecraft".to_string()).unwrap();

    let console_info_log = format!(
        "{} [/{}]: Executing \"{}\" from the console.\n\r",
        &timestamp, &log_type, &command
    );
    window
        .emit(
            "custom-server-process-output",
            CustomServerEventPayload {
                server_id: server_id.clone(),
                data: console_info_log.clone(),
            },
        )
        .map_err(|e| format!("Failed to emit custom-server-process-output: {}", e))
        .unwrap();

    let response = client.send_command(command).unwrap();

    let response_log = format!("{} [/{}]: {}\n\r", &timestamp, &log_type, &response.body);
    window
        .emit(
            "custom-server-process-output",
            CustomServerEventPayload {
                server_id: server_id,
                data: response_log.clone(),
            },
        )
        .map_err(|e| format!("Failed to emit custom-server-process-output: {}", e))
        .unwrap();

    Ok(response.body)
}

#[tauri::command]
async fn get_rcon_server_info() -> Result<HashMap<String, String>, String> {
    let mut client = Client::new("127.0.0.1:25594".to_string()).unwrap();
    client.authenticate("minecraft".to_string()).unwrap();

    let mut server_info: HashMap<String, String> = HashMap::new();

    server_info.insert(
        String::from("seed"),
        client.send_command(String::from("seed")).unwrap().body,
    );
    server_info.insert(
        String::from("difficulty"),
        client
            .send_command(String::from("difficulty"))
            .unwrap()
            .body,
    );
    server_info.insert(
        String::from("list"),
        client.send_command(String::from("list")).unwrap().body,
    );
    server_info.insert(
        String::from("whitelist"),
        client
            .send_command(String::from("whitelist list"))
            .unwrap()
            .body,
    );

    Ok(server_info)
}

#[tauri::command]
async fn delete_custom_server(id: &str, token: &str, uuid: &str) -> Result<(), String> {
    ApiEndpoints::norisk_delete_custom_server(id, token, uuid)
        .await
        .map_err(|e| format!("unable to delete custom server: {:?}", e))?;

    let path = LAUNCHER_DIRECTORY
        .data_dir()
        .join("custom_servers")
        .join(id);

    if path.exists() {
        fs::remove_dir_all(path)
            .await
            .map_err(|e| format!("unable to delete custom server files: {:?}", e))?;
    }

    Ok(())
}

///
/// Custom Vanilla Server
///
#[tauri::command]
async fn get_all_vanilla_versions() -> Result<VanillaVersions, String> {
    VanillaProvider::get_all_versions()
        .await
        .map_err(|e| format!("unable to get all vanilla versions: {:?}", e))
}

#[tauri::command]
async fn get_vanilla_manifest(hash: &str, version: &str) -> Result<VanillaManifest, String> {
    VanillaProvider::get_manifest(hash, version)
        .await
        .map_err(|e| format!("unable to get vanilla manifest: {:?}", e))
}

///
/// Custom Fabric Server
///
#[tauri::command]
async fn get_all_fabric_game_versions() -> Result<Vec<FabricVersion>, String> {
    FabricProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all fabric game versions: {:?}", e))
}

#[tauri::command]
async fn get_all_fabric_loader_versions(
    mc_version: &str,
) -> Result<Vec<FabricLoaderVersion>, String> {
    FabricProvider::get_all_loader_versions(mc_version)
        .await
        .map_err(|e| format!("unable to get all fabric loader versions: {:?}", e))
}

///
/// Custom Quilt Server
///
#[tauri::command]
async fn get_quilt_manifest() -> Result<QuiltManifest, String> {
    QuiltProvider::get_manifest()
        .await
        .map_err(|e| format!("unable to get quilt manifest: {:?}", e))
}

///
/// Custom Forge Server
///
#[tauri::command]
async fn get_forge_manifest() -> Result<ForgeManifest, String> {
    ForgeProvider::get_manifest()
        .await
        .map_err(|e| format!("unable to get forge manifest: {:?}", e))
}

///
/// Custom Forge Server
///
#[tauri::command]
async fn get_neoforge_manifest() -> Result<NeoForgeManifest, String> {
    NeoForgeProvider::get_manifest()
        .await
        .map_err(|e| format!("unable to get neoforge manifest: {:?}", e))
}

///
/// Custom Paper Server
///
#[tauri::command]
async fn get_all_paper_game_versions() -> Result<PaperManifest, String> {
    PaperProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all paper game versions: {:?}", e))
}

#[tauri::command]
async fn get_all_paper_build_versions(mc_version: &str) -> Result<PaperBuilds, String> {
    PaperProvider::get_all_build_versions(mc_version)
        .await
        .map_err(|e| format!("unable to get all paper build versions: {:?}", e))
}

///
/// Custom Folia Server
///
#[tauri::command]
async fn get_all_folia_game_versions() -> Result<FoliaManifest, String> {
    FoliaProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all folia game versions: {:?}", e))
}

#[tauri::command]
async fn get_all_folia_build_versions(mc_version: &str) -> Result<FoliaBuilds, String> {
    FoliaProvider::get_all_build_versions(mc_version)
        .await
        .map_err(|e| format!("unable to get all folia build versions: {:?}", e))
}

///
/// Custom Purpur Server
///
#[tauri::command]
async fn get_all_purpur_game_versions() -> Result<PurpurVersions, String> {
    PurpurProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all purpur game versions: {:?}", e))
}

///
/// Custom Spigot Server
///
#[tauri::command]
async fn get_all_spigot_game_versions() -> Result<Vec<String>, String> {
    SpigotProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all spigot game versions: {:?}", e))
}

///
/// Custom Bukkit Server
///
#[tauri::command]
async fn get_all_bukkit_game_versions() -> Result<Vec<String>, String> {
    BukkitProvider::get_all_game_versions()
        .await
        .map_err(|e| format!("unable to get all bukkit game versions: {:?}", e))
}

///
/// Get All feature toggles
///
#[tauri::command]
async fn get_full_feature_whitelist(
    options: LauncherOptions,
    credentials: Credentials,
) -> Result<Vec<String>, String> {
    ApiEndpoints::norisk_full_feature_whitelist(
        &credentials
            .norisk_credentials
            .get_token(options.experimental_mode)
            .await
            .unwrap(),
        &credentials.id.to_string(),
    )
        .await
        .map_err(|e| format!("unable to get full feature whitelist: {:?}", e))
}


///
/// Get Launcher feature toggles
///
#[tauri::command]
async fn check_feature_whitelist(
    feature: &str,
    options: LauncherOptions,
    credentials: Credentials,
) -> Result<bool, String> {
    ApiEndpoints::norisk_feature_whitelist(
        feature,
        &credentials
            .norisk_credentials
            .get_token(options.experimental_mode)
            .await
            .unwrap(),
        &credentials.id.to_string(),
    )
        .await
        .map_err(|e| format!("unable to check feature whitelist: {:?}", e))
}

/// Runs the GUI and returns when the window is closed.
pub fn gui_main() {
    tauri::Builder::default()
        .on_window_event(move |event| match event.event() {
            WindowEvent::Destroyed => {
                info!("Window destroyed, quitting application");
            }
            _ => {}
        })
        .plugin(tauri_plugin_fs_watch::init())
        .setup(|app| {
            NRCCache::initialize_app_state(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_online_status,
            get_launcher_version,
            check_privacy_policy,
            accept_privacy_policy,
            get_options,
            open_minecraft_logs_window,
            open_minecraft_crash_window,
            read_txt_file,
            get_latest_minecraft_logs,
            minecraft_auth_get_store,
            minecraft_auth_get_default_user,
            minecraft_auth_set_default_user,
            minecraft_auth_remove_user,
            minecraft_auth_users,
            minecraft_auth_update_norisk_token,
            minecraft_auth_update_mojang_and_norisk_token,
            store_options,
            get_norisk_user,
            check_maintenance_mode,
            request_norisk_branches,
            discord_auth_link,
            discord_auth_status,
            discord_auth_unlink,
            upload_cape,
            equip_cape,
            delete_cape,
            get_player_skins,
            save_player_skin,
            read_local_skin_file,
            read_remote_image_file,
            get_cape_hash_by_uuid,
            mc_name_by_uuid,
            microsoft_auth,
            unequip_cape,
            search_mods,
            get_mod_author,
            get_featured_mods,
            get_featured_resourcepacks,
            get_featured_shaders,
            get_featured_datapacks,
            get_blacklisted_mods,
            get_blacklisted_resourcepacks,
            get_blacklisted_shaders,
            get_blacklisted_datapacks,
            get_blacklisted_servers,
            get_whitelist_slots,
            add_player_to_whitelist,
            check_for_new_branch,
            get_branches_from_folder,
            get_default_mc_folder,
            copy_mc_data,
            copy_branch_data,
            run_client,
            enable_experimental_mode,
            download_template_and_open_explorer,
            request_trending_capes,
            request_user_capes,
            request_owned_capes,
            refresh_via_norisk,
            get_mobile_app_token,
            reset_mobile_app_token,
            clear_cache,
            get_changelogs,
            get_announcements,
            get_last_viewed_popups,
            store_last_viewed_popups,
            get_mod_info,
            console_log_info,
            console_log_warning,
            console_log_error,
            get_launcher_profiles,
            store_launcher_profiles,
            get_project_versions,
            get_custom_mods_filenames,
            save_custom_mod_to_folder,
            delete_custom_mod_file,
            install_mod_and_dependencies,
            get_custom_shaders_folder,
            delete_shader_file,
            save_custom_shader_to_folder,
            get_custom_shaders_filenames,
            search_shaders,
            get_shader_info,
            get_shader,
            download_shader,
            get_custom_resourcepacks_folder,
            delete_resourcepack_file,
            save_custom_resourcepack_to_folder,
            get_custom_resourcepacks_filenames,
            search_resourcepacks,
            get_resourcepack_info,
            get_resourcepack,
            download_resourcepack,
            get_custom_datapacks_folder,
            delete_datapack_file,
            save_custom_datapack_to_folder,
            get_custom_datapacks_filenames,
            get_running_instances,
            search_datapacks,
            get_datapack_info,
            get_datapack,
            download_datapack,
            get_world_folders,
            enable_keep_local_assets,
            disable_keep_local_assets,
            get_keep_local_assets,
            upload_logs,
            get_launch_manifest,
            default_data_folder_path,
            terminate,
            quit_everything,
            get_featured_servers,
            get_custom_servers,
            check_custom_server_subdomain,
            get_custom_server_jwt_token,
            create_custom_server,
            initialize_custom_server,
            run_custom_server,
            check_if_custom_server_running,
            terminate_custom_server,
            execute_rcon_command,
            get_rcon_server_info,
            delete_custom_server,
            get_all_vanilla_versions,
            get_vanilla_manifest,
            get_all_fabric_game_versions,
            get_all_fabric_loader_versions,
            get_quilt_manifest,
            get_forge_manifest,
            get_neoforge_manifest,
            get_all_paper_game_versions,
            get_all_paper_build_versions,
            get_all_folia_game_versions,
            get_all_folia_build_versions,
            get_all_purpur_game_versions,
            get_all_spigot_game_versions,
            get_total_memory,
            get_all_bukkit_game_versions,
            check_feature_whitelist,
            get_full_feature_whitelist,
            export_profile_and_open_explorer,
            import_launcher_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
