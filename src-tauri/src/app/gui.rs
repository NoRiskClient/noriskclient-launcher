use std::{collections::HashMap, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, thread};

use directories::UserDirs;
use log::{debug, error, info};
use reqwest::multipart::{Form, Part};
use tauri::{Manager, Window, WindowEvent};
use tauri::api::dialog::blocking::message;
use tokio::{fs, io::AsyncReadExt};

use crate::{custom_servers::{manager::CustomServerManager, models::CustomServer, providers::{bukkit::BukkitProvider, fabric::{FabricLoaderVersion, FabricProvider, FabricVersion}, folia::{FoliaBuilds, FoliaManifest, FoliaProvider}, forge::{ForgeManifest, ForgeProvider}, neoforge::{NeoForgeManifest, NeoForgeProvider}, paper::{PaperBuilds, PaperManifest, PaperProvider}, purpur::{PurpurProvider, PurpurVersions}, quilt::{QuiltManifest, QuiltProvider}, spigot::SpigotProvider, vanilla::{VanillaManifest, VanillaProvider, VanillaVersions}}}, minecraft::{launcher::{LauncherData, LaunchingParameter}, prelauncher, progress::ProgressUpdate}, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::app::api::{LoginData, NoRiskLaunchManifest};
use crate::app::app_data::TokenManager;
use crate::app::cape_api::{Cape, CapeApiEndpoints};
use crate::app::mclogs_api::{McLogsApiEndpoints, McLogsUploadResponse};
use crate::app::modrinth_api::{CustomMod, ModInfo, ModrinthApiEndpoints, ModrinthProject, ModrinthSearchRequestParams, ModrinthModsSearchResponse};
use crate::minecraft::auth;
use crate::utils::percentage_of_total_memory;

use super::{api::{ApiEndpoints, CustomServersResponse, FeaturedServer, LoaderMod, WhitelistSlots}, app_data::{LauncherOptions, LauncherProfiles}, modrinth_api::{Datapack, DatapackInfo, ModrinthDatapacksSearchResponse, ModrinthResourcePacksSearchResponse, ModrinthShadersSearchResponse, ResourcePack, ResourcePackInfo, Shader, ShaderInfo}};

struct RunnerInstance {
    terminator: tokio::sync::oneshot::Sender<()>,
}

struct AppState {
    runner_instance: Arc<Mutex<Option<RunnerInstance>>>,
    custom_server_instance: Arc<Mutex<Option<RunnerInstance>>>,
    forwarding_manager_running_state: Arc<AtomicBool>,
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
    id: String
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
async fn get_mobile_app_token(norisk_token: &str, uuid: &str, is_experimental: bool) -> Result<String, String> {
    match ApiEndpoints::get_mcreal_app_token(norisk_token, uuid, is_experimental).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err("Error Requesting mcreal App token".to_string())
        }
    }
}

#[tauri::command]
async fn reset_mobile_app_token(norisk_token: &str, uuid: &str, is_experimental: bool) -> Result<String, String> {
    match ApiEndpoints::reset_mcreal_app_token(norisk_token, uuid, is_experimental).await {
        Ok(result) => {
            Ok(result)
        }
        Err(_err) => {
            Err("Error Requesting mcreal App token".to_string())
        }
    }
}

#[tauri::command]
async fn get_options() -> Result<LauncherOptions, String> {
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
async fn request_norisk_branches(norisk_token: &str) -> Result<Vec<String>, String> {
    let branches = ApiEndpoints::norisk_branches(norisk_token)
        .await
        .map_err(|e| format!("unable to request branches: {:?}", e))?;
    Ok(branches)
}

#[tauri::command]
async fn enable_experimental_mode(experimental_token: &str) -> Result<bool, String> {
    return ApiEndpoints::enable_experimental_mode(experimental_token)
        .await
        .map_err(|e| format!("unable to validate experimental token: {:?}", e));
}

#[tauri::command]
async fn get_launch_manifest(branch: &str, norisk_token: &str) -> Result<NoRiskLaunchManifest, String> {
    let manifest = ApiEndpoints::launch_manifest(branch, norisk_token).await
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
async fn login_norisk_microsoft(options: LauncherOptions, handle: tauri::AppHandle) -> Result<LoginData, String> {
    let auth_prepare_response = ApiEndpoints::auth_prepare_response().await;
    match auth_prepare_response {
        Ok(response) => {
            // Hier kannst du auf die Daten von 'response' zugreifen
            let url = response.url;
            let id = response.id;
            let _ = open_url(url.as_str(), handle);

            let login_data = ApiEndpoints::await_auth_response(id).await;
            match login_data {
                Ok(response) => {
                    info!("Received NoRisk Auth Response");
                    Ok(LoginData {
                        norisk_token: if options.experimental_mode { String::from("") } else { response.norisk_token.clone() },
                        experimental_token: Some(if options.experimental_mode { response.norisk_token.clone() } else { String::from("") }),
                        ..response
                    })
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

#[tauri::command]
async fn remove_account(login_data: LoginData) -> Result<(), String> {
    TokenManager {}.delete_tokens(login_data);
    Ok(())
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
async fn run_client(branch: String, login_data: LoginData, options: LauncherOptions, force_server: Option<String>, mods: Vec<LoaderMod>, shaders: Vec<Shader>, resourcepacks: Vec<ResourcePack>, datapacks: Vec<Datapack>, window: Window, app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("Starting Client with branch {}",branch);
    let window_mutex = Arc::new(std::sync::Mutex::new(window));

    let parameters = LaunchingParameter {
        dev_mode: options.experimental_mode,
        force_server: force_server,
        memory: percentage_of_total_memory(options.memory_percentage),
        data_path: options.data_path_buf(),
        custom_java_path: if !options.custom_java_path.is_empty() { Some(options.custom_java_path) } else { None },
        custom_java_args: options.custom_java_args,
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

    let experimental_token = login_data.experimental_token.unwrap_or_default();
    let norisk_token = login_data.norisk_token;

    info!("Loading launch manifest...");
    let launch_manifest = ApiEndpoints::launch_manifest(&branch, (if options.experimental_mode { experimental_token.clone() } else { norisk_token.clone() }).to_string().as_mut())
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
                    &if options.experimental_mode {
                        experimental_token
                    } else {
                        norisk_token
                    },
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
async fn get_whitelist_slots(norisk_token: &str) -> Result<WhitelistSlots, String> {
    let response = ApiEndpoints::whitelist_slots(norisk_token).await;
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
async fn add_player_to_whitelist(identifier: &str, norisk_token: &str) -> Result<(), String> {
    let response = HTTP_CLIENT.get(format!("https://playerdb.co/api/player/minecraft/{}", identifier)).send().await.map_err(|e| format!("invalid username: {:}", e)).unwrap();
    let response_text = response.json::<PlayerDBData>().await.unwrap();
    let uuid = response_text.data.player.unwrap().id;
    let response = ApiEndpoints::whitelist_add_user(&uuid, norisk_token).await;
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
async fn clear_data(options: LauncherOptions) -> Result<(), String> {
    let _ = options.accounts.iter().map(|account| TokenManager {}.delete_tokens(account.clone()));

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
async fn get_custom_servers(token: &str) -> Result<CustomServersResponse, String> {
    match ApiEndpoints::norisk_custom_servers(token).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn check_custom_server_subdomain(subdomain: &str, token: &str) -> Result<(), String> {
    match ApiEndpoints::norisk_check_custom_server_subdomain(subdomain, token).await {
        Ok(_result) => {
            Ok(())
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn get_custom_server_jwt_token(custom_server_id: &str, token: &str) -> Result<String, String> {
    match ApiEndpoints::norisk_get_custom_server_jwt_token(custom_server_id, token).await {
        Ok(result) => {
            Ok(result)
        }
        Err(err) => {
            Err(err.to_string())
        }
    }
}

#[tauri::command]
async fn create_custom_server(mc_version: &str, loader_version: Option<&str>, r#type: &str, subdomain: &str, token: &str) -> Result<CustomServer, String> {
    match ApiEndpoints::norisk_create_custom_server(mc_version, loader_version, r#type, subdomain, token).await {
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
async fn run_custom_server(custom_server: CustomServer, options: LauncherOptions, token: String, window: Window, app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    let window_mutex = Arc::new(std::sync::Mutex::new(window));
    let custom_server_instance = app_state.custom_server_instance.clone();
    
    let (server_terminator_tx, server_terminator_rx) = tokio::sync::oneshot::channel();

    *custom_server_instance.lock().map_err(|e| format!("unable to lock custom server instance: {:?}", e))?
        = Some(RunnerInstance { terminator: server_terminator_tx });
    
    app_state.forwarding_manager_running_state.store(true, Ordering::SeqCst);

    let copy_of_custom_server_instance = custom_server_instance;
    let copy_of_forwarding_manager_running_state = app_state.forwarding_manager_running_state.clone();

    thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                if let Err(e) = CustomServerManager::run_server(custom_server, options, token, server_terminator_rx, copy_of_forwarding_manager_running_state.clone(), window_mutex.clone()).await {
                    window_mutex.lock().unwrap().emit("s-error", format!("Failed to launch server: {:?}", e)).unwrap();
                    handle_stderr(&window_mutex, format!("Failed to launch server: {:?}", e).as_bytes()).unwrap();
                };
                
                *copy_of_custom_server_instance.lock().map_err(|e| format!("unable to lock custom_server instance: {:?}", e)).unwrap()
                    = None;
                copy_of_forwarding_manager_running_state.store(false, Ordering::SeqCst);

                window_mutex.lock().unwrap().emit("server-exited", ()).unwrap()
            });
    });
    Ok(())
}

#[tauri::command]
async fn terminate_custom_server(app_state: tauri::State<'_, AppState>) -> Result<(), String> {
    let custom_server_instance = app_state.custom_server_instance.clone();
    let mut custom_server_lck = custom_server_instance.lock()
        .map_err(|e| format!("unable to lock custom_server instance: {:?}", e))?;

    if let Some(inst) = custom_server_lck.take() {
        info!("Killing Custom Server");
        inst.terminator.send(()).map_err(|e| format!("unable to send custom server terminator: {:?}", e)).unwrap();
    }

    info!("Killing Forwarding Manager");
    app_state.forwarding_manager_running_state.store(false,  Ordering::SeqCst);

    Ok(())
}

#[tauri::command]
async fn delete_custom_server(id: &str, token: &str) -> Result<(), String> {
    match ApiEndpoints::norisk_delete_custom_server(id, token).await {
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
async fn get_feature_toggles() -> Result<HashMap<String, Vec<String>>, String> {
    let feature_toggles = ApiEndpoints::norisk_feature_toggles().await
        .map_err(|e| format!("unable to get feature toggles: {:?}", e))?;
    Ok(feature_toggles)
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
            let _window = app.get_window("main").unwrap();
            Ok(())
        })
        .manage(AppState {
            runner_instance: Arc::new(Mutex::new(None)),
            custom_server_instance: Arc::new(Mutex::new(None)),
            forwarding_manager_running_state: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            open_url,
            check_online_status,
            get_options,
            store_options,
            request_norisk_branches,
            login_norisk_microsoft,
            remove_account,
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
            get_featured_resourcepacks,
            get_featured_shaders,
            get_featured_datapacks,
            get_whitelist_slots,
            add_player_to_whitelist,
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
            get_feature_toggles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
