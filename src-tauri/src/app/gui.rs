use std::{io, path::PathBuf, sync::{Arc, Mutex}, thread};
use std::fs::File;
use std::io::BufRead;
use dirs::data_dir;

use chrono::Utc;
use directories::UserDirs;
use log::{debug, error, info};
use reqwest::multipart::{Form, Part};
use tauri::{Manager, UserAttentionType, Window, WindowEvent};
use tauri::api::dialog::blocking::message;
use tokio::{fs, io::{AsyncReadExt, AsyncWriteExt}, process::Child};

use crate::{custom_servers::{manager::CustomServerManager, models::CustomServer, providers::{bukkit::BukkitProvider, fabric::{FabricLoaderVersion, FabricProvider, FabricVersion}, folia::{FoliaBuilds, FoliaManifest, FoliaProvider}, forge::{ForgeManifest, ForgeProvider}, neoforge::{NeoForgeManifest, NeoForgeProvider}, paper::{PaperBuilds, PaperManifest, PaperProvider}, purpur::{PurpurProvider, PurpurVersions}, quilt::{QuiltManifest, QuiltProvider}, spigot::SpigotProvider, vanilla::{VanillaManifest, VanillaProvider, VanillaVersions}}}, minecraft::{launcher::{LauncherData, LaunchingParameter}, prelauncher, progress::ProgressUpdate}, utils::McDataHandler, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::app::api::{LoginData, NoRiskLaunchManifest};
use crate::app::cape_api::{Cape, CapeApiEndpoints};
use crate::app::mclogs_api::{McLogsApiEndpoints, McLogsUploadResponse};
use crate::app::modrinth_api::{CustomMod, ModInfo, ModrinthApiEndpoints, ModrinthModsSearchResponse, ModrinthProject, ModrinthSearchRequestParams};
use crate::error::ErrorKind;
use crate::minecraft::auth;
use crate::minecraft::minecraft_auth::{Credentials, MinecraftAuthStore};
use crate::utils::percentage_of_total_memory;

use super::{api::{ApiEndpoints, CustomServersResponse, FeaturedServer, LoaderMod, NoRiskUserMinimal, WhitelistSlots}, app_data::{LauncherOptions, LauncherProfiles}, modrinth_api::{Datapack, DatapackInfo, ModrinthDatapacksSearchResponse, ModrinthResourcePacksSearchResponse, ModrinthShadersSearchResponse, ResourcePack, ResourcePackInfo, Shader, ShaderInfo}};

struct RunnerInstance {
    terminator: tokio::sync::oneshot::Sender<()>,
}

struct AppState {
    runner_instance: Arc<Mutex<Option<RunnerInstance>>>,
    forwarding_manager_process: Arc<Mutex<Option<Child>>>,
    custom_server_process: Arc<Mutex<Option<Child>>>,
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

#[derive(serde::Deserialize)]
struct PlayerDBData {
    data: PlayerDBEntry,
}

#[derive(serde::Deserialize)]
struct PlayerDBEntry {
    player: Option<PlayerDBPlayer>,
}

#[derive(serde::Deserialize)]
struct PlayerDBPlayer {
    id: String,
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
fn open_url(url: &str, handle: tauri::AppHandle) -> Result<(), String> {
    let window = tauri::WindowBuilder::new(
        &handle,
        "external", /* the unique window label */
        tauri::WindowUrl::External(url.parse().unwrap()),
    ).build().unwrap();
    let _ = window.set_title("NoRiskClient");
    let _ = window.set_resizable(false);
    let _ = window.set_focus();
    let _ = window.set_minimizable(false);
    let _ = window.set_maximizable(false);
    let _ = window.set_always_on_top(true);
    Ok(())
}

#[tauri::command]
async fn upload_cape(norisk_token: &str, uuid: &str, window: tauri::Window) -> Result<(), String> {
    debug!("Uploading Cape...");
    use tauri::api::dialog::blocking::FileDialogBuilder; // Note the updated import

    let dialog_result = FileDialogBuilder::new()
        .set_title("Select Cape")
        .add_filter("Pictures", &["png"])
        .pick_file();

    // dialog_result will be of type Option<PathBuf> now.

    match CapeApiEndpoints::upload_cape(norisk_token, uuid, dialog_result.unwrap()).await {
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
async fn equip_cape(norisk_token: &str, uuid: &str, hash: &str, window: tauri::Window) -> Result<(), String> {
    debug!("Equiping Cape...");

    match CapeApiEndpoints::equip_cape(norisk_token, uuid, hash).await {
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
async fn get_featured_mods(branch: &str, mc_version: &str, window: tauri::Window) -> Result<Vec<ModInfo>, String> {
    debug!("Getting Featured Mods...");

    match ApiEndpoints::norisk_featured_mods(&branch).await {
        Ok(result) => {
            // fetch mod info for each mod
            let mut mod_infos: Vec<ModInfo> = Vec::new();
            for mod_id in result {
                match ModrinthApiEndpoints::get_mod_info(&*mod_id).await {
                    Ok(mod_info) => {
                        // Filter featured mods based on mc version
                        match &mod_info.game_versions {
                            Some(versions) => {
                                if versions.contains(&mc_version.to_string()) {
                                    mod_infos.push(mod_info);
                                } else {
                                    debug!("Featured mod {} does not support version {}", mod_info.title, mc_version);
                                }
                            }
                            _ => {
                                error!("Featured mod {} has no game versions", mod_info.title);
                            }
                        }
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
async fn get_featured_resourcepacks(branch: &str, mc_version: &str, window: tauri::Window) -> Result<Vec<ResourcePackInfo>, String> {
    debug!("Getting Featured ResourcePacks...");

    match ApiEndpoints::norisk_featured_resourcepacks(&branch).await {
        Ok(result) => {
            // fetch resourcepack info for each resourcepack
            let mut resourcepack_infos: Vec<ResourcePackInfo> = Vec::new();
            for resourcepack_id in result {
                match ModrinthApiEndpoints::get_resourcepack_info(&*resourcepack_id).await {
                    Ok(resourcepack_info) => {
                        // Filter featured resourcepacks based on mc version
                        match &resourcepack_info.game_versions {
                            Some(versions) => {
                                if versions.contains(&mc_version.to_string()) {
                                    resourcepack_infos.push(resourcepack_info);
                                } else {
                                    debug!("Featured resourcepack {} does not support version {}", resourcepack_info.title, mc_version);
                                }
                            }
                            _ => {
                                error!("Featured resourcepack {} has no game versions", resourcepack_info.title);
                            }
                        }
                    }
                    Err(err) => {
                        message(Some(&window), "Modrinth Error", err.to_string());
                    }
                }
            }
            Ok(resourcepack_infos)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_featured_shaders(branch: &str, mc_version: &str, window: tauri::Window) -> Result<Vec<ShaderInfo>, String> {
    debug!("Getting Featured Shaders...");

    match ApiEndpoints::norisk_featured_shaders(&branch).await {
        Ok(result) => {
            // fetch shader info for each resourcepack
            let mut shader_infos: Vec<ShaderInfo> = Vec::new();
            for shader_id in result {
                match ModrinthApiEndpoints::get_shader_info(&*shader_id).await {
                    Ok(shader_info) => {
                        // Filter featured shaders based on mc version
                        match &shader_info.game_versions {
                            Some(versions) => {
                                if versions.contains(&mc_version.to_string()) {
                                    shader_infos.push(shader_info);
                                } else {
                                    debug!("Featured shader {} does not support version {}", shader_info.title, mc_version);
                                }
                            }
                            _ => {
                                error!("Featured shader {} has no game versions", shader_info.title);
                            }
                        }
                    }
                    Err(err) => {
                        message(Some(&window), "Modrinth Error", err.to_string());
                    }
                }
            }
            Ok(shader_infos)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_featured_datapacks(branch: &str, mc_version: &str, window: tauri::Window) -> Result<Vec<DatapackInfo>, String> {
    debug!("Getting Featured Datapacks...");

    match ApiEndpoints::norisk_featured_datapacks(&branch).await {
        Ok(result) => {
            // fetch datapack info for each resourcepack
            let mut datapack_infos: Vec<DatapackInfo> = Vec::new();
            for datapack_id in result {
                match ModrinthApiEndpoints::get_datapack_info(&*datapack_id).await {
                    Ok(datapack_info) => {
                        // Filter featured datapacks based on mc version
                        match &datapack_info.game_versions {
                            Some(versions) => {
                                if versions.contains(&mc_version.to_string()) {
                                    datapack_infos.push(datapack_info);
                                } else {
                                    debug!("Featured datapack {} does not support version {}", datapack_info.title, mc_version);
                                }
                            }
                            _ => {
                                error!("Featured datapack {} has no game versions", datapack_info.title);
                            }
                        }
                    }
                    Err(err) => {
                        message(Some(&window), "Modrinth Error", err.to_string());
                    }
                }
            }
            Ok(datapack_infos)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_blacklisted_mods() -> Result<Vec<String>, String> {
    debug!("Getting Blacklisted Mods...");

    match ApiEndpoints::norisk_blacklisted_mods().await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_blacklisted_resourcepacks() -> Result<Vec<String>, String> {
    debug!("Getting Blacklisted ResourcePacks...");

    match ApiEndpoints::norisk_blacklisted_resourcepacks().await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_blacklisted_shaders() -> Result<Vec<String>, String> {
    debug!("Getting Blacklisted Shaders...");

    match ApiEndpoints::norisk_blacklisted_shaders().await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_blacklisted_datapacks() -> Result<Vec<String>, String> {
    debug!("Getting Blacklisted Datapacks...");

    match ApiEndpoints::norisk_blacklisted_datapacks().await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_blacklisted_servers() -> Result<Vec<FeaturedServer>, String> {
    debug!("Getting Blacklisted Servers...");

    match ApiEndpoints::norisk_blacklisted_servers().await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn search_mods(params: ModrinthSearchRequestParams, window: Window) -> Result<ModrinthModsSearchResponse, String> {
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
async fn console_log_info(message: String) {
    log::info!("{}" ,message);
}

#[tauri::command]
async fn console_log_error(message: String) {
    log::error!("{}" ,message);
}

#[tauri::command]
async fn get_mod_info(slug: String, window: Window) -> Result<ModInfo, String> {
    debug!("Fetching mod info...");

    match ModrinthApiEndpoints::get_mod_info(&slug).await {
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
async fn install_mod_and_dependencies(slug: &str, params: &str, required_mods: Vec<LoaderMod>, window: Window) -> Result<CustomMod, String> {
    info!("Installing Mod And Dependencies...");
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
async fn get_project_version(slug: &str, params: &str, window: Window) -> Result<Vec<ModrinthProject>, String> {
    info!("Searching Project Version...");

    match ModrinthApiEndpoints::get_project_version(slug, params).await {
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
async fn search_shaders(params: ModrinthSearchRequestParams, window: Window) -> Result<ModrinthShadersSearchResponse, String> {
    debug!("Searching Shaders...");

    match ModrinthApiEndpoints::search_shaders(&params).await {
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
async fn get_shader_info(slug: String, window: Window) -> Result<ShaderInfo, String> {
    debug!("Fetching shader info...");

    match ModrinthApiEndpoints::get_shader_info(&slug).await {
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
async fn install_shader(slug: &str, params: &str, window: Window) -> Result<Shader, String> {
    info!("Installing Shader...");
    match ModrinthApiEndpoints::install_shader(slug, params).await {
        Ok(installed_shader) => {
            Ok(installed_shader)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn search_resourcepacks(params: ModrinthSearchRequestParams, window: Window) -> Result<ModrinthResourcePacksSearchResponse, String> {
    debug!("Searching ResourcePacks...");

    match ModrinthApiEndpoints::search_resourcepacks(&params).await {
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
async fn get_resourcepack_info(slug: String, window: Window) -> Result<ResourcePackInfo, String> {
    debug!("Fetching ResourcePack info...");

    match ModrinthApiEndpoints::get_resourcepack_info(&slug).await {
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
async fn install_resourcepack(slug: &str, params: &str, window: Window) -> Result<ResourcePack, String> {
    info!("Installing ResourcePack...");
    match ModrinthApiEndpoints::install_resourcepack(slug, params).await {
        Ok(installed_resourcepack) => {
            Ok(installed_resourcepack)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn search_datapacks(params: ModrinthSearchRequestParams, window: Window) -> Result<ModrinthDatapacksSearchResponse, String> {
    debug!("Searching Datapacks...");

    match ModrinthApiEndpoints::search_datapacks(&params).await {
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
async fn get_datapack_info(slug: String, window: Window) -> Result<DatapackInfo, String> {
    debug!("Fetching Datapack info...");

    match ModrinthApiEndpoints::get_datapack_info(&slug).await {
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
async fn install_datapack(slug: &str, params: &str, world: &str, window: Window) -> Result<Datapack, String> {
    info!("Installing Datapack...");
    match ModrinthApiEndpoints::install_datapack(slug, params, world).await {
        Ok(installed_datapack) => {
            Ok(installed_datapack)
        }
        Err(err) => {
            message(Some(&window), "Modrinth Error", err.to_string());
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_world_folders(branch: String) -> Result<Vec<String>, String> {
    let mut world_folders: Vec<String> = Vec::new();
    let world_folder = LAUNCHER_DIRECTORY.data_dir().join("gameDir").join(&branch).join("saves");
    if world_folder.exists() {
        let mut entries = fs::read_dir(world_folder).await.map_err(|e| format!("unable to read world folders: {:?}", e))?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| format!("unable to read world folder: {:?}", e))? {
            let path = entry.path();
            if path.is_dir() {
                world_folders.push(path.file_name().unwrap().to_str().unwrap().to_string());
            }
        }
    }
    Ok(world_folders)
}

#[tauri::command]
async fn delete_cape(norisk_token: &str, uuid: &str, window: Window) -> Result<(), String> {
    debug!("Deleting Cape...");
    // dialog_result will be of type Option<PathBuf> now.

    match CapeApiEndpoints::delete_cape(norisk_token, uuid).await {
        Ok(_) => { () }
        Err(err) => {
            message(Some(&window), "Cape Error", err);
        }
    }
    Ok(())
}

#[tauri::command]
async fn request_trending_capes(norisk_token: &str, uuid: &str, alltime: u32, limit: u32) -> Result<Vec<Cape>, String> {
    match CapeApiEndpoints::request_trending_capes(norisk_token, uuid, alltime, limit).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err("Error Requesting Trending Capes".to_string())
        }
    }
}

#[tauri::command]
async fn request_owned_capes(norisk_token: &str, uuid: &str, limit: u32) -> Result<Vec<Cape>, String> {
    match CapeApiEndpoints::request_owned_capes(norisk_token, uuid, limit).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err("Error Requesting Owned Capes".to_string())
        }
    }
}

#[tauri::command]
async fn download_template_and_open_explorer() -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;
    let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
    let template_url = if options.experimental_mode {
        "https://dl-staging.norisk.gg/capes/prod/template.png"
    } else {
        "https://dl.norisk.gg/capes/prod/template.png"
    };
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
async fn get_mobile_app_token(norisk_token: &str, uuid: &str) -> Result<String, String> {
    match ApiEndpoints::get_mcreal_app_token(norisk_token, uuid).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err(format!("Error Requesting mcreal App token: {:?}", _err))
        }
    }
}

#[tauri::command]
async fn reset_mobile_app_token(norisk_token: &str, uuid: &str) -> Result<String, String> {
    match ApiEndpoints::reset_mcreal_app_token(norisk_token, uuid).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err("Error Requesting mcreal App token".to_string())
        }
    }
}

#[tauri::command]
pub async fn open_minecraft_logs_window(handle: tauri::AppHandle) -> Result<(), crate::error::Error> {
    let window = tauri::WindowBuilder::new(
        &handle,
        "local",
        tauri::WindowUrl::App("/#/logs".into()),
    ).build()?;
    let _ = window.set_title("Minecraft Logs");
    let _ = window.set_resizable(true);
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn open_minecraft_crash_window(handle: tauri::AppHandle) -> Result<(), crate::error::Error> {
    let window = tauri::WindowBuilder::new(
        &handle,
        "crash",
        tauri::WindowUrl::App("/#/crash".into()),
    ).build()?;
    let _ = window.set_title("Crash Report");
    let _ = window.set_resizable(true);
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn get_latest_minecraft_logs() -> Result<Vec<String>, crate::error::Error> {
    let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
    let latest_branch = if options.experimental_mode {
        options.latest_dev_branch
    } else {
        options.latest_branch
    }.ok_or(ErrorKind::OtherError("No Latest Branch was found".to_string()).as_error())?;

    let log_path: PathBuf = LAUNCHER_DIRECTORY.data_dir()
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
async fn minecraft_auth_get_store() -> Result<MinecraftAuthStore, crate::error::Error> {
    Ok(MinecraftAuthStore::init(None).await?)
}

#[tauri::command]
pub async fn minecraft_auth_remove_user(uuid: uuid::Uuid) -> Result<Option<Credentials>, crate::error::Error> {
    Ok(minecraft_auth_get_store().await?.remove(uuid).await?)
}

#[tauri::command]
pub async fn minecraft_auth_get_default_user() -> Result<Option<Credentials>, crate::error::Error> {
    let accounts = minecraft_auth_get_store().await?;
    Ok(accounts.users.get(&accounts.default_user.ok_or(ErrorKind::NoCredentialsError)?).cloned())
}

#[tauri::command]
pub async fn minecraft_auth_set_default_user(uuid: uuid::Uuid) -> Result<(), crate::error::Error> {
    let mut accounts = minecraft_auth_get_store().await?;
    accounts.default_user = Some(uuid);
    accounts.save().await?;
    Ok(())
}

/// Get a copy of the list of all user credentials
// invoke('plugin:auth|auth_users',user)
#[tauri::command]
pub async fn minecraft_auth_users() -> Result<Vec<Credentials>, crate::error::Error> {
    let accounts = minecraft_auth_get_store().await?;
    Ok(accounts.users.values().cloned().collect())
}

#[tauri::command]
pub async fn minecraft_auth_update_norisk_token(credentials: Credentials) -> Result<Credentials, crate::error::Error> {
    let mut accounts = minecraft_auth_get_store().await?;
    Ok(accounts.refresh_norisk_token(&credentials).await?)
}

#[tauri::command]
pub async fn minecraft_auth_update_mojang_and_norisk_token(credentials: Credentials) -> Result<Credentials, crate::error::Error> {
    return Ok(minecraft_auth_get_store().await?.update_norisk_and_microsoft_token(&credentials).await?.ok_or(ErrorKind::NoCredentialsError)?);
}

#[tauri::command]
pub async fn get_options() -> Result<LauncherOptions, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    let options = LauncherOptions::load(config_dir).await.unwrap_or_default(); // default to basic options if unable to load

    Ok(options)
}

#[tauri::command]
async fn get_launcher_profiles() -> Result<LauncherProfiles, String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    let launcher_profiles = LauncherProfiles::load(config_dir).await.unwrap_or_default(); // default to basic launcher_profiles defaults if unable to load

    Ok(launcher_profiles)
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

    info!("Saving {} to {}-{} custom mods folder.", file.name.clone(), branch, mc_version);

    if let Err(err) = fs::copy(PathBuf::from(file.location), &file_path).await {
        return Err(format!("Error saving custom mod {}: {}", file.name, err));
    }

    Ok(())
}

#[tauri::command]
async fn get_custom_shaders_filenames(options: LauncherOptions, installed_shaders: Vec<Shader>, branch: &str) -> Result<Vec<String>, String> {
    let custom_shader_folder = options.data_path_buf().join("gameDir").join(branch).join("shaderpacks");
    let names = ModrinthApiEndpoints::get_custom_shader_names(&custom_shader_folder, &installed_shaders).await.map_err(|e| format!("unable to load config filenames: {:?}", e))?;
    Ok(names)
}

#[tauri::command]
async fn get_custom_shaders_folder(options: LauncherOptions, branch: &str) -> Result<String, String> {
    let custom_shader_folder = options.data_path_buf().join("gameDir").join(branch).join("shaderpacks");
    return custom_shader_folder.to_str().map(|s| s.to_string()).ok_or_else(|| "Error converting path to string".to_string());
}

#[tauri::command]
async fn save_custom_shaders_to_folder(options: LauncherOptions, branch: &str, file: FileData) -> Result<(), String> {
    let file_path = options.data_path_buf().join("gameDir").join(branch).join("shaderpacks").join(file.name.clone());

    info!("Saving {} to {} shaders folder.", file.name.clone(), branch);

    if let Err(err) = fs::copy(PathBuf::from(file.location), &file_path).await {
        return Err(format!("Error saving custom shader {}: {}", file.name, err));
    }

    Ok(())
}

#[tauri::command]
async fn get_custom_resourcepacks_filenames(options: LauncherOptions, installed_resourcepacks: Vec<ResourcePack>, branch: &str) -> Result<Vec<String>, String> {
    let custom_resourcepack_folder = options.data_path_buf().join("gameDir").join(branch).join("resourcepacks");
    let names = ModrinthApiEndpoints::get_custom_resourcepack_names(&custom_resourcepack_folder, &installed_resourcepacks).await.map_err(|e| format!("unable to load config filenames: {:?}", e))?;
    Ok(names)
}

#[tauri::command]
async fn get_custom_resourcepacks_folder(options: LauncherOptions, branch: &str) -> Result<String, String> {
    let custom_resourcepack_folder = options.data_path_buf().join("gameDir").join(branch).join("resourcepacks");
    return custom_resourcepack_folder.to_str().map(|s| s.to_string()).ok_or_else(|| "Error converting path to string".to_string());
}

#[tauri::command]
async fn save_custom_resourcepacks_to_folder(options: LauncherOptions, branch: &str, file: FileData) -> Result<(), String> {
    let file_path = options.data_path_buf().join("gameDir").join(branch).join("resourcepacks").join(file.name.clone());

    info!("Saving {} to {} resourcepacks folder.", file.name.clone(), branch);

    if let Err(err) = fs::copy(PathBuf::from(file.location), &file_path).await {
        return Err(format!("Error saving custom resourcepack {}: {}", file.name, err));
    }

    Ok(())
}

#[tauri::command]
async fn get_custom_datapacks_filenames(options: LauncherOptions, installed_datapacks: Vec<Datapack>, branch: &str, world: &str) -> Result<Vec<String>, String> {
    let custom_datapack_folder = options.data_path_buf().join("gameDir").join(branch).join("saves").join(world).join("datapacks");
    let names = ModrinthApiEndpoints::get_custom_datapack_names(&custom_datapack_folder, &installed_datapacks).await.map_err(|e| format!("unable to load config filenames: {:?}", e))?;
    Ok(names)
}

#[tauri::command]
async fn get_custom_datapacks_folder(options: LauncherOptions, branch: &str, world: &str) -> Result<String, String> {
    let custom_datapack_folder = options.data_path_buf().join("gameDir").join(branch).join("saves").join(world).join("datapacks");
    return custom_datapack_folder.to_str().map(|s| s.to_string()).ok_or_else(|| "Error converting path to string".to_string());
}

#[tauri::command]
async fn save_custom_datapacks_to_folder(options: LauncherOptions, branch: &str, world: &str, file: FileData) -> Result<(), String> {
    let file_path = options.data_path_buf().join("gameDir").join(branch).join("saves").join(world).join("datapacks").join(file.name.clone());

    info!("Saving {} to {} datapacks folder.", file.name.clone(), branch);

    if let Err(err) = fs::copy(PathBuf::from(file.location), &file_path).await {
        return Err(format!("Error saving custom datapack {}: {}", file.name, err));
    }

    Ok(())
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
        }
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
        info!("Skin {} saved successfully.", &location);
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
        }
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
async fn store_launcher_profiles(launcher_profiles: LauncherProfiles) -> Result<(), String> {
    let config_dir = LAUNCHER_DIRECTORY.config_dir();
    launcher_profiles.store(config_dir)
        .await
        .map_err(|e| format!("unable to store launcher_profiles data: {:?}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_norisk_user(options: LauncherOptions, credentials: Credentials) -> Result<NoRiskUserMinimal, String> {
    let user = ApiEndpoints::get_norisk_user(&credentials.norisk_credentials.get_token(options.experimental_mode).unwrap(), &credentials.id.to_string())
        .await
        .map_err(|e| format!("unable to request norisk user: {:?}", e))?;
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
async fn toggle_maintenance_mode(maintenance_mode: bool, options: LauncherOptions, credentials: Credentials) -> Result<String, String> {
    let maintenance_mode = ApiEndpoints::toggle_norisk_maintenance_mode(maintenance_mode, &credentials.norisk_credentials.get_token(options.experimental_mode).unwrap(), &credentials.id.to_string())
        .await
        .map_err(|e| format!("unable to update maintenance mode: {:?}", e))?;
    Ok(maintenance_mode)
}

#[tauri::command]
async fn request_norisk_branches(options: LauncherOptions, credentials: Credentials) -> Result<Vec<String>, crate::error::Error> {
    Ok(ApiEndpoints::norisk_branches(&credentials.norisk_credentials.get_token(options.experimental_mode)?, &credentials.id.to_string()).await?)
}

#[tauri::command]
async fn enable_experimental_mode(experimental_token: &str) -> Result<bool, String> {
    return ApiEndpoints::enable_experimental_mode(experimental_token)
        .await
        .map_err(|e| format!("unable to validate experimental token: {:?}", e));
}

#[tauri::command]
async fn get_launch_manifest(branch: &str) -> Result<NoRiskLaunchManifest, crate::error::Error> {
    Ok(ApiEndpoints::launch_manifest(branch).await?)
}

#[tauri::command]
async fn upload_logs(log: String) -> Result<McLogsUploadResponse, String> {
    let log_response = McLogsApiEndpoints::upload_logs(log).await
        .map_err(|e| format!("unable to upload logs: {:?}", e))?;
    Ok(log_response)
}

#[tauri::command]
async fn discord_auth_link(options: LauncherOptions, credentials: Credentials, app: tauri::AppHandle) -> Result<(), crate::error::Error> {
    let token = credentials.norisk_credentials.get_token(options.experimental_mode)?;
    let url = format!("https://api{}.norisk.gg/api/v1/core/oauth/discord?token={}", if options.experimental_mode.clone() { "-staging" } else { "" }, token);

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
        .inner_size(1000.0, 900.0)
        .resizable(false)
        .minimizable(false)
        .center()
        .build()?;

    window.request_user_attention(Some(UserAttentionType::Critical))?;

    while (Utc::now() - start) < chrono::Duration::minutes(10) {
        if window.title().is_err() {
            // user closed window, cancelling flow
            return Ok(());
        }

        if window.url().as_str().starts_with("https://api.norisk.gg/api/v1/core/oauth/discord/complete") {
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
async fn discord_auth_status(options: LauncherOptions, credentials: Credentials) -> Result<bool, crate::error::Error> {
    Ok(ApiEndpoints::discord_link_status(&credentials.norisk_credentials.get_token(options.experimental_mode)?, &credentials.id.to_string()).await?)
}

#[tauri::command]
async fn discord_auth_unlink(credentials: Credentials, options: LauncherOptions) -> Result<(), crate::error::Error> {
    ApiEndpoints::unlink_discord(&credentials.norisk_credentials.get_token(options.experimental_mode)?, &credentials.id.to_string()).await?;
    Ok(())
}

#[tauri::command]
async fn microsoft_auth(app: tauri::AppHandle) -> Result<Option<Credentials>, crate::error::Error> {
    let mut accounts = MinecraftAuthStore::init(None).await?;

    let flow = accounts.login_begin().await?;

    let start = Utc::now();

    if let Some(window) = app.get_window("signin") {
        window.close()?;
    }

    let window = tauri::WindowBuilder::new(
        &app,
        "signin",
        tauri::WindowUrl::External(flow.redirect_uri.parse().map_err(
            |_| {
                crate::error::ErrorKind::OtherError(
                    "Error parsing auth redirect URL".to_string(),
                )
                    .as_error()
            },
        )?),
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
            if let Some((_, code)) =
                window.url().query_pairs().find(|x| x.0 == "code")
            {
                window.close()?;
                let credentials = accounts.login_finish(&code.clone(), flow, app.get_window("main").unwrap()).await?;

                app.get_window("main").unwrap().emit("microsoft-output", "NoRisk Token").unwrap_or_default();

                match accounts.refresh_norisk_token(&credentials.clone()).await {
                    Ok(credentials_with_norisk) => {
                        debug!("After Microsoft Auth: Successfully received NoRiskClient Token");
                        return Ok(Some(credentials_with_norisk));
                    }
                    Err(err) => {
                        //Ist uns aber egal Microsoft Auth hat geklappt
                        debug!("After Microsoft Auth: Error Fetching NoRiskClient Token {:?}", err)
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

fn handle_stdout(window: &Arc<Mutex<Window>>, data: &[u8]) -> anyhow::Result<()> {
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
async fn check_for_new_branch(branch: &str) -> Result<Option<bool>, String> {
    let options = get_options().await.map_err(|e| format!("unable to load options: {:?}", e))?;
    let game_dir_path = options.data_path_buf().join("gameDir");
    if !game_dir_path.exists() {
        return Ok(None);
    }

    let all_branches = game_dir_path.read_dir().map_err(|e| format!("unable to read branches: {:?}", e))?.filter(|entry| entry.as_ref().map(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false)).unwrap_or(false)).map(|entry| entry.map(|e| e.file_name().into_string().unwrap())).collect::<Result<Vec<String>, _>>().map_err(|e| format!("unable to read branches: {:?}", e))?;
    if all_branches.len() <= 0 {
        return Ok(None);
    }
    
    let branch_path = game_dir_path.join(branch);

    Ok(Some(!branch_path.exists()))
}

#[tauri::command]
async fn get_branches_from_folder() -> Result<Vec<String>, String> {
    let options = get_options().await.map_err(|e| format!("unable to load options: {:?}", e))?;
    let game_dir_path = options.data_path_buf().join("gameDir");
    if !game_dir_path.exists() {
        return Ok(Vec::new());
    }

    let branches = game_dir_path.read_dir().map_err(|e| format!("unable to read branches: {:?}", e))?.filter(|entry| entry.as_ref().map(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false)).unwrap_or(false)).map(|entry| entry.map(|e| e.file_name().into_string().unwrap())).collect::<Result<Vec<String>, _>>().map_err(|e| format!("unable to read branches: {:?}", e))?;

    Ok(branches)
}

#[tauri::command]
async fn get_default_mc_folder() -> Result<String, String> {
    if let Some(appdata_dir) = data_dir() {
        let minecraft_folder = appdata_dir.join(".minecraft");
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
async fn copy_branch_data(old_branch: &str, new_branch: &str, app: tauri::AppHandle) -> Result<(), String> {
    McDataHandler::copy_branch_data(old_branch, new_branch, app).await
}

#[tauri::command]
async fn run_client(branch: String, options: LauncherOptions, force_server: Option<String>, mods: Vec<LoaderMod>, shaders: Vec<Shader>, resourcepacks: Vec<ResourcePack>, datapacks: Vec<Datapack>, window: Window, app_state: tauri::State<'_, AppState>) -> Result<(), crate::error::Error> {
    debug!("Starting Client with branch {}",branch);
    let credentials = minecraft_auth_get_store().await?.get_default_credential().await?.ok_or(ErrorKind::NoCredentialsError)?;
    let window_mutex = Arc::new(std::sync::Mutex::new(window));

    let parameters = LaunchingParameter {
        dev_mode: options.experimental_mode,
        force_server: force_server,
        memory: percentage_of_total_memory(options.memory_percentage),
        data_path: options.data_path_buf(),
        custom_java_path: if !options.custom_java_path.is_empty() { Some(options.custom_java_path) } else { None },
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

    let runner_instance = &app_state.runner_instance;

    if runner_instance.lock().map_err(|e| ErrorKind::LauncherError(format!("unable to lock runner instance: {:?}", e)).as_error())?.is_some() {
        return Err(ErrorKind::LauncherError("client is already running".to_string()).into());
    }

    let token = if options.experimental_mode {
        credentials.norisk_credentials.experimental.ok_or(ErrorKind::NoCredentialsError)?.value
    } else {
        credentials.norisk_credentials.production.ok_or(ErrorKind::NoCredentialsError)?.value
    };


    info!("Loading launch manifest...");
    let launch_manifest = get_launch_manifest(&branch).await?;

    let (terminator_tx, terminator_rx) = tokio::sync::oneshot::channel();

    *runner_instance.lock().map_err(|e| ErrorKind::LauncherError(format!("unable to lock runner instance: {:?}", e)).as_error())?
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
                    &token,
                    &credentials.id.to_string(),
                    launch_manifest,
                    parameters,
                    mods,
                    shaders,
                    resourcepacks,
                    datapacks,
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
    let runner_instance = app_state.runner_instance.clone();
    let mut lck = runner_instance.lock()
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
async fn get_whitelist_slots(norisk_token: &str, uuid: &str) -> Result<WhitelistSlots, String> {
    let response = ApiEndpoints::whitelist_slots(norisk_token, uuid).await;
    match response {
        Ok(slots) => {
            Ok(slots)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn add_player_to_whitelist(identifier: &str, norisk_token: &str, request_uuid: &str) -> Result<(), String> {
    let response = HTTP_CLIENT.get(format!("https://playerdb.co/api/player/minecraft/{}", identifier)).send().await.map_err(|e| format!("invalid username: {:}", e)).unwrap();
    let response_text = response.json::<PlayerDBData>().await.unwrap();
    let uuid = response_text.data.player.unwrap().id;
    let response = ApiEndpoints::whitelist_add_user(&uuid, norisk_token, request_uuid).await;
    match response {
        Ok(_) => {
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
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
async fn clear_data(options: LauncherOptions) -> Result<(), crate::error::Error> {
    let auth_store = MinecraftAuthStore::init(Some(true)).await?;
    auth_store.save().await?;

    let _ = store_options(LauncherOptions::default()).await;
    let _ = store_launcher_profiles(LauncherProfiles::default()).await;

    ["assets", "gameDir", "libraries", "mod_cache", "custom_mods", "natives", "runtimes", "versions"]
        .iter()
        .map(|dir| options.data_path_buf().join(dir))
        .filter(|dir| dir.exists())
        .map(std::fs::remove_dir_all)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| ErrorKind::OtherError(format!("unable to clear data: {:?}", e)))?;
    Ok(())
}

///
/// Custom Servers
///
#[tauri::command]
async fn get_featured_servers(branch: &str) -> Result<Vec<FeaturedServer>, String> {
    match ApiEndpoints::norisk_featured_servers(branch).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_custom_servers(token: &str, uuid: &str) -> Result<CustomServersResponse, String> {
    match ApiEndpoints::norisk_custom_servers(token, uuid).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn check_custom_server_subdomain(subdomain: &str, token: &str, uuid: &str) -> Result<(), String> {
    match ApiEndpoints::norisk_check_custom_server_subdomain(subdomain, token, uuid).await {
        Ok(_result) => {
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_custom_server_jwt_token(custom_server_id: &str, token: &str, uuid: &str) -> Result<String, String> {
    match ApiEndpoints::norisk_get_custom_server_jwt_token(custom_server_id, token, uuid).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn create_custom_server(mc_version: &str, loader_version: Option<&str>, r#type: &str, subdomain: &str, token: &str, uuid: &str) -> Result<CustomServer, String> {
    match ApiEndpoints::norisk_create_custom_server(mc_version, loader_version, r#type, subdomain, token, uuid).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn initialize_custom_server(custom_server: CustomServer, additional_data: Option<&str>, window: Window) -> Result<(), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window));
    match CustomServerManager::initialize_server(&window_mutex, custom_server, additional_data).await {
        Ok(_) => {
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn run_custom_server(custom_server: CustomServer, options: LauncherOptions, token: String, window: Window) -> Result<(), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window));
    let custom_server_process_mutex = Arc::new(std::sync::Mutex::new(None));

    thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let custom_server_process = CustomServerManager::run_server(custom_server, options, token, window_mutex.clone()).await.unwrap();
                // if let Err(e) = custom_server_process {
                //     window_mutex.lock().unwrap().emit("s-error", format!("Failed to launch server: {:?}", e)).unwrap();
                //     handle_stderr(&window_mutex, format!("Failed to launch server: {:?}", e).as_bytes()).unwrap();
                // };

                custom_server_process_mutex.lock().unwrap().replace(custom_server_process);

                window_mutex.lock().unwrap().emit("server-exited", ()).unwrap()
            });
    });
    Ok(())
}

#[tauri::command]
async fn terminate_custom_server(app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("Killing Custom Server");
    let mut custom_server_process = app_state.custom_server_process.lock().unwrap().take().unwrap();
    custom_server_process.stdin.as_mut().unwrap().write_all(b"stop\n").await.unwrap();
    // custom_server_process.kill().await.unwrap();

    info!("Killing Forwarding Manager");
    let mut custom_sever_forwarding_process = app_state.forwarding_manager_process.lock().unwrap().take().unwrap();
    custom_sever_forwarding_process.kill().await.unwrap();

    Ok(())
}

#[tauri::command]
async fn delete_custom_server(id: &str, token: &str, uuid: &str) -> Result<(), String> {
    match ApiEndpoints::norisk_delete_custom_server(id, token, uuid).await {
        Ok(_) => {
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

///
/// Custom Vanilla Server
///
#[tauri::command]
async fn get_all_vanilla_versions() -> Result<VanillaVersions, String> {
    let versions = VanillaProvider::get_all_versions().await
        .map_err(|e| format!("unable to get all vanilla versions: {:?}", e))?;
    Ok(versions)
}

#[tauri::command]
async fn get_vanilla_manifest(hash: &str, version: &str) -> Result<VanillaManifest, String> {
    let manifest = VanillaProvider::get_manifest(hash, version).await
        .map_err(|e| format!("unable to get vanilla manifest: {:?}", e))?;
    Ok(manifest)
}

// #[tauri::command]
// async fn download_vanilla_server_jar(custom_server: CustomServer, hash: &str) -> Result<(), String> {
//     let server_jar = VanillaProvider::download_server_jar(&custom_server, hash).await
//         .map_err(|e| format!("unable to download vanilla server jar: {:?}", e))?;
//     Ok(server_jar)

// }

///
/// Custom Fabric Server
///
#[tauri::command]
async fn get_all_fabric_game_versions() -> Result<Vec<FabricVersion>, String> {
    let versions = FabricProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all fabric game versions: {:?}", e))?;
    Ok(versions)
}

#[tauri::command]
async fn get_all_fabric_loader_versions(mc_version: &str) -> Result<Vec<FabricLoaderVersion>, String> {
    let versions = FabricProvider::get_all_loader_versions(mc_version).await
        .map_err(|e| format!("unable to get all fabric loader versions: {:?}", e))?;
    Ok(versions)
}

///
/// Custom Quilt Server
///
#[tauri::command]
async fn get_quilt_manifest() -> Result<QuiltManifest, String> {
    let manifest = QuiltProvider::get_manifest().await
        .map_err(|e| format!("unable to get quilt manifest: {:?}", e))?;
    Ok(manifest)
}

///
/// Custom Forge Server
///
#[tauri::command]
async fn get_forge_manifest() -> Result<ForgeManifest, String> {
    let manifest = ForgeProvider::get_manifest().await
        .map_err(|e| format!("unable to get forge manifest: {:?}", e))?;
    Ok(manifest)
}

///
/// Custom Forge Server
///
#[tauri::command]
async fn get_neoforge_manifest() -> Result<NeoForgeManifest, String> {
    let manifest = NeoForgeProvider::get_manifest().await
        .map_err(|e| format!("unable to get neoforge manifest: {:?}", e))?;
    Ok(manifest)
}

///
/// Custom Paper Server
///
#[tauri::command]
async fn get_all_paper_game_versions() -> Result<PaperManifest, String> {
    let manifest = PaperProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all paper game versions: {:?}", e))?;
    Ok(manifest)
}

#[tauri::command]
async fn get_all_paper_build_versions(mc_version: &str) -> Result<PaperBuilds, String> {
    let build_versions = PaperProvider::get_all_build_versions(mc_version).await
        .map_err(|e| format!("unable to get all paper build versions: {:?}", e))?;
    Ok(build_versions)
}

///
/// Custom Folia Server
///
#[tauri::command]
async fn get_all_folia_game_versions() -> Result<FoliaManifest, String> {
    let manifest = FoliaProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all folia game versions: {:?}", e))?;
    Ok(manifest)
}

#[tauri::command]
async fn get_all_folia_build_versions(mc_version: &str) -> Result<FoliaBuilds, String> {
    let versions = FoliaProvider::get_all_build_versions(mc_version).await
        .map_err(|e| format!("unable to get all folia build versions: {:?}", e))?;
    Ok(versions)
}

///
/// Custom Purpur Server
///
#[tauri::command]
async fn get_all_purpur_game_versions() -> Result<PurpurVersions, String> {
    let versions = PurpurProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all purpur game versions: {:?}", e))?;
    Ok(versions)
}

///
/// Custom Spigot Server
///
#[tauri::command]
async fn get_all_spigot_game_versions() -> Result<Vec<String>, String> {
    let versions = SpigotProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all spigot game versions: {:?}", e))?;
    Ok(versions)
}

///
/// Custom Bukkit Server
///
#[tauri::command]
async fn get_all_bukkit_game_versions() -> Result<Vec<String>, String> {
    let versions = BukkitProvider::get_all_game_versions().await
        .map_err(|e| format!("unable to get all bukkit game versions: {:?}", e))?;
    Ok(versions)
}

///
/// Get Launcher feature toggles
///
#[tauri::command]
async fn check_feature_whitelist(feature: &str, norisk_token: &str, uuid: &str) -> Result<bool, String> {
    let is_whitelisted = ApiEndpoints::norisk_feature_whitelist(feature, norisk_token, uuid).await
        .map_err(|e| format!("unable to check feature whitelist: {:?}", e))?;
    Ok(is_whitelisted)
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
        .setup(|_| {
            Ok(())
        })
        .manage(AppState {
            runner_instance: Arc::new(Mutex::new(None)),
            forwarding_manager_process: Arc::new(Mutex::new(None)),
            custom_server_process: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            check_online_status,
            get_options,
            open_minecraft_logs_window,
            open_minecraft_crash_window,
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
            toggle_maintenance_mode,
            request_norisk_branches,
            discord_auth_link,
            discord_auth_status,
            discord_auth_unlink,
            upload_cape,
            equip_cape,
            get_player_skins,
            save_player_skin,
            read_local_skin_file,
            read_remote_image_file,
            get_cape_hash_by_uuid,
            mc_name_by_uuid,
            microsoft_auth,
            delete_cape,
            search_mods,
            get_featured_mods,
            get_featured_resourcepacks,
            get_featured_shaders,
            get_featured_datapacks,
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
            request_owned_capes,
            refresh_via_norisk,
            get_mobile_app_token,
            reset_mobile_app_token,
            clear_data,
            get_mod_info,
            console_log_info,
            console_log_error,
            get_launcher_profiles,
            store_launcher_profiles,
            get_project_version,
            get_custom_mods_folder,
            save_custom_mods_to_folder,
            install_mod_and_dependencies,
            get_custom_mods_filenames,
            get_custom_shaders_folder,
            save_custom_shaders_to_folder,
            get_custom_shaders_filenames,
            search_shaders,
            get_shader_info,
            install_shader,
            get_custom_resourcepacks_folder,
            save_custom_resourcepacks_to_folder,
            get_custom_resourcepacks_filenames,
            search_resourcepacks,
            get_resourcepack_info,
            install_resourcepack,
            get_custom_datapacks_folder,
            save_custom_datapacks_to_folder,
            get_custom_datapacks_filenames,
            search_datapacks,
            get_datapack_info,
            install_datapack,
            get_world_folders,
            upload_logs,
            get_launch_manifest,
            mem_percentage,
            default_data_folder_path,
            terminate,
            get_featured_servers,
            get_custom_servers,
            check_custom_server_subdomain,
            get_custom_server_jwt_token,
            create_custom_server,
            initialize_custom_server,
            run_custom_server,
            terminate_custom_server,
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
            get_all_bukkit_game_versions,
            check_feature_whitelist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
