use crate::error::{AppError, CommandError};
use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::integrations::curseforge::{
    get_mod_files, search_mods, CurseForgeModSearchSortField, CurseForgeSortOrder,
};
use crate::state::profile_state::{ImageSource, Mod, ModLoader, ModSource, Profile};
use crate::state::state_manager::State;
use crate::minecraft::api::{ForgeApi, NeoForgeApi};
use base64::Engine;
use image::imageops::FilterType;
use log::warn;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{BufRead, BufReader, Cursor, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use sysinfo::{Pid, Signal, System};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

static RUNNING_SERVERS: Lazy<Mutex<HashMap<String, Child>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const USER_AGENT: &str = "NoRiskClient-LocalServers/0.1";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalServer {
    pub id: String,
    pub name: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub loader_version: Option<String>,
    #[serde(default)]
    pub server_ip: Option<String>,
    pub port: u16,
    pub ram_mb: u32,
    pub java_path: Option<String>,
    #[serde(default = "default_server_kind")]
    pub server_kind: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon_path: Option<String>,
    #[serde(default)]
    pub codex_enabled: bool,
    #[serde(default)]
    pub codex_mcp_port: Option<u16>,
    #[serde(default)]
    pub auto_update_content: bool,
    pub status: String,
    pub created_at: String,
    pub last_started_at: Option<String>,
    pub installed_content: Vec<InstalledContent>,
    #[serde(default)]
    pub invited_users: Vec<ServerUser>,
    #[serde(default)]
    pub database: Option<ServerDatabase>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledContent {
    pub name: String,
    pub source: String,
    pub project_id: Option<String>,
    pub file_name: String,
    pub kind: String,
    pub version: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerUser {
    pub name: String,
    pub role: String,
    pub invited_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerDatabase {
    pub enabled: bool,
    pub database_type: String,
    pub name: String,
    pub path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftVersionEntry {
    pub id: String,
    pub version_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersionEntry {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServerFileEntry {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerBackup {
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalServerInput {
    pub name: String,
    pub server_type: String,
    pub minecraft_version: String,
    pub loader_version: Option<String>,
    pub server_ip: Option<String>,
    pub port: u16,
    pub ram_mb: u32,
    pub java_path: Option<String>,
    pub server_kind: Option<String>,
    pub description: Option<String>,
    pub icon_path: Option<String>,
    pub codex_enabled: Option<bool>,
    pub codex_mcp_port: Option<u16>,
    pub auto_update_content: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalServerInput {
    pub source_path: String,
    #[serde(flatten)]
    pub server: CreateLocalServerInput,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLocalServerSettingsInput {
    pub name: Option<String>,
    pub server_type: Option<String>,
    pub minecraft_version: Option<String>,
    pub loader_version: Option<String>,
    pub server_ip: Option<String>,
    pub port: Option<u16>,
    pub ram_mb: Option<u32>,
    pub java_path: Option<String>,
    pub server_kind: Option<String>,
    pub description: Option<String>,
    pub icon_path: Option<String>,
    pub codex_enabled: Option<bool>,
    pub codex_mcp_port: Option<u16>,
    pub auto_update_content: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCatalogSearchInput {
    pub query: String,
    pub kind: String,
    pub minecraft_version: String,
    pub loader: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCatalogResult {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub project_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BedrockProfile {
    pub id: String,
    pub name: String,
    pub icon_path: Option<String>,
    pub target: String,
    pub created_at: String,
    pub last_launched_at: Option<String>,
    pub installed_content: Vec<BedrockInstalledContent>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BedrockInstance {
    pub id: String,
    pub name: String,
    pub target: String,
    pub pid: u32,
    pub started_at: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BedrockCatalogResult {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub author: Option<String>,
    pub project_url: String,
    pub download_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BedrockInstalledContent {
    pub name: String,
    pub source: String,
    pub file_name: String,
    pub kind: String,
    pub path: String,
    pub imported_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBedrockProfileInput {
    pub name: String,
    pub icon_path: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBedrockProfileInput {
    pub name: Option<String>,
    pub icon_path: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallBedrockSkinPackInput {
    pub name: String,
    pub base64_data: String,
    pub variant: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogPayload {
    server_id: String,
    stream: String,
    line: String,
}

#[tauri::command]
pub async fn list_local_servers() -> Result<Vec<LocalServer>, CommandError> {
    ensure_dir(&servers_root())?;
    let mut servers = Vec::new();

    for entry in fs::read_dir(servers_root()).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        if !entry.file_type().map_err(AppError::from)?.is_dir() {
            continue;
        }

        let metadata_path = entry.path().join("server-app.json");
        if metadata_path.exists() {
            let mut server: LocalServer =
                serde_json::from_str(&fs::read_to_string(metadata_path).map_err(AppError::from)?)
                    .map_err(AppError::from)?;
            server.status = if is_running(&server.id) {
                "running".to_string()
            } else {
                "stopped".to_string()
            };
            servers.push(server);
        }
    }

    servers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(servers)
}

#[tauri::command]
pub async fn list_local_server_minecraft_versions() -> Result<Vec<MinecraftVersionEntry>, CommandError> {
    let manifest: Value = reqwest::Client::new()
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    let versions = manifest["versions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|version| {
            Some(MinecraftVersionEntry {
                id: version["id"].as_str()?.to_string(),
                version_type: version["type"].as_str().unwrap_or("release").to_string(),
            })
        })
        .collect();

    Ok(versions)
}

#[tauri::command]
pub async fn list_local_server_fabric_loader_versions() -> Result<Vec<LoaderVersionEntry>, CommandError> {
    let versions: Value = reqwest::Client::new()
        .get("https://meta.fabricmc.net/v2/versions/loader")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    Ok(versions
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            Some(LoaderVersionEntry {
                version: item["version"].as_str()?.to_string(),
                stable: item["stable"].as_bool().unwrap_or(false),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn create_local_server(input: CreateLocalServerInput) -> Result<LocalServer, CommandError> {
    validate_create_input(&input)?;
    let id = Uuid::new_v4().to_string();
    let server_dir = server_dir(&id);
    ensure_dir(&server_dir)?;
    ensure_server_runtime_dirs(&server_dir, &input.server_type)?;

    let server_kind = input
        .server_kind
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| kind_for_loader(&input.server_type).to_string());

    let mut server = LocalServer {
        id,
        name: input.name.trim().to_string(),
        server_type: input.server_type,
        minecraft_version: input.minecraft_version.trim().to_string(),
        loader_version: input.loader_version.filter(|value| !value.trim().is_empty()),
        server_ip: input.server_ip.filter(|value| !value.trim().is_empty()),
        port: input.port,
        ram_mb: input.ram_mb,
        java_path: input.java_path.filter(|value| !value.trim().is_empty()),
        server_kind,
        description: input.description.filter(|value| !value.trim().is_empty()),
        icon_path: input.icon_path.filter(|value| !value.trim().is_empty()),
        codex_enabled: input.codex_enabled.unwrap_or(false),
        codex_mcp_port: input.codex_mcp_port,
        auto_update_content: input.auto_update_content.unwrap_or(false),
        status: "stopped".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_started_at: None,
        installed_content: Vec::new(),
        invited_users: Vec::new(),
        database: None,
    };

    fs::write(server_dir.join("eula.txt"), "eula=true\n").map_err(AppError::from)?;
    write_server_properties(&server)?;

    match server.server_type.as_str() {
        "paper" | "spigot" | "bukkit" => download_paper_server(&server).await?,
        "fabric" => download_fabric_server(&mut server).await?,
        "forge" => install_forge_server(&mut server).await?,
        "neoforge" => install_neoforge_server(&mut server).await?,
        "vanilla" => download_vanilla_server(&server).await?,
        "bedrock" => download_bedrock_server(&mut server).await?,
        _ => unreachable!("validated server type"),
    }

    write_server_metadata(&server)?;
    write_codex_metadata(&server)?;
    sync_server_icon(&server).await?;
    Ok(server)
}

#[tauri::command]
pub async fn create_local_server_from_profile(profile_id: String) -> Result<LocalServer, CommandError> {
    let profile_uuid = Uuid::parse_str(&profile_id)
        .map_err(|error| AppError::InvalidInput(format!("Ungültige Profil-ID: {error}")))?;
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_uuid).await?;
    let server_type = server_type_for_profile(&profile);
    let server_kind = kind_for_loader(&server_type).to_string();
    let loader_version = if matches!(profile.loader, ModLoader::Fabric | ModLoader::Forge | ModLoader::NeoForge) {
        profile.loader_version.clone()
    } else {
        None
    };
    let icon_path = profile_icon_value(&profile, &state).await;

    let mut server = create_local_server(CreateLocalServerInput {
        name: profile.name.clone(),
        server_type,
        minecraft_version: profile.game_version.clone(),
        loader_version,
        server_ip: None,
        port: 25565,
        ram_mb: profile.settings.memory.max.max(512),
        java_path: if profile.settings.use_custom_java_path {
            profile.settings.java_path.clone()
        } else {
            None
        },
        server_kind: Some(server_kind),
        description: Some(format!("Aus Profil {} erstellt", profile.name)),
        icon_path,
        codex_enabled: Some(false),
        codex_mcp_port: Some(8765),
        auto_update_content: Some(true),
    })
    .await?;

    copy_profile_content(&profile, &state, &mut server)?;
    write_server_metadata(&server)?;
    sync_server_icon(&server).await?;
    Ok(server)
}

#[tauri::command]
pub async fn import_local_server(input: ImportLocalServerInput) -> Result<LocalServer, CommandError> {
    validate_create_input(&input.server)?;
    let source = PathBuf::from(&input.source_path);
    if !source.is_dir() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Der importierte Server muss ein Ordner sein.".to_string(),
        )));
    }

    let id = Uuid::new_v4().to_string();
    let target = server_dir(&id);
    ensure_dir(&target)?;
    copy_dir_contents(&source, &target)?;
    ensure_server_runtime_dirs(&target, &input.server.server_type)?;

    let server = LocalServer {
        id,
        name: input.server.name.trim().to_string(),
        server_type: input.server.server_type.clone(),
        minecraft_version: input.server.minecraft_version.trim().to_string(),
        loader_version: input.server.loader_version.filter(|value| !value.trim().is_empty()),
        server_ip: input.server.server_ip.filter(|value| !value.trim().is_empty()),
        port: input.server.port,
        ram_mb: input.server.ram_mb,
        java_path: input.server.java_path.filter(|value| !value.trim().is_empty()),
        server_kind: input
            .server
            .server_kind
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| kind_for_loader(&input.server.server_type).to_string()),
        description: input.server.description.filter(|value| !value.trim().is_empty()),
        icon_path: input.server.icon_path.filter(|value| !value.trim().is_empty()),
        codex_enabled: input.server.codex_enabled.unwrap_or(false),
        codex_mcp_port: input.server.codex_mcp_port,
        auto_update_content: input.server.auto_update_content.unwrap_or(false),
        status: "stopped".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_started_at: None,
        installed_content: Vec::new(),
        invited_users: Vec::new(),
        database: None,
    };

    write_server_properties(&server)?;
    write_server_metadata(&server)?;
    write_codex_metadata(&server)?;
    sync_server_icon(&server).await?;
    Ok(server)
}

#[tauri::command]
pub async fn duplicate_local_server(server_id: String) -> Result<LocalServer, CommandError> {
    if is_running(&server_id) {
        return Err(CommandError::from(AppError::InvalidInput(
            "Stoppe den Server, bevor du ihn kopierst.".to_string(),
        )));
    }

    let source = read_server_metadata(&server_id)?;
    let new_id = Uuid::new_v4().to_string();
    let source_dir = server_dir(&server_id);
    let target_dir = server_dir(&new_id);
    copy_dir_contents(&source_dir, &target_dir)?;

    let mut copy = source.clone();
    copy.id = new_id;
    copy.name = format!("{} Kopie", source.name);
    copy.status = "stopped".to_string();
    copy.created_at = chrono::Utc::now().to_rfc3339();
    copy.last_started_at = None;
    write_server_properties(&copy)?;
    write_server_metadata(&copy)?;
    write_codex_metadata(&copy)?;
    sync_server_icon(&copy).await?;
    Ok(copy)
}

#[tauri::command]
pub async fn delete_local_server(server_id: String) -> Result<(), CommandError> {
    if is_running(&server_id) {
        let _ = stop_local_server(server_id.clone()).await;
    }

    let dir = server_dir(&server_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_minecraft_bedrock_installed() -> Result<bool, CommandError> {
    Ok(minecraft_bedrock_package_dir().is_some())
}

#[tauri::command]
pub async fn open_minecraft_bedrock() -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    {
        if minecraft_bedrock_package_dir().is_none() {
            return Err(CommandError::from(AppError::NotFound(
                "Minecraft Bedrock wurde auf diesem PC nicht gefunden.".to_string(),
            )));
        }

        launch_windows_store_app("MICROSOFT.MINECRAFTUWP_8wekyb3d8bbwe!Game")
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(CommandError::from(AppError::UnsupportedOS(
            "Minecraft Bedrock wird hier nur auf Windows erkannt.".to_string(),
        )))
    }
}

#[tauri::command]
pub async fn open_minecraft_bedrock_preview() -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    {
        if minecraft_bedrock_preview_package_dir().is_none() {
            return Err(CommandError::from(AppError::NotFound(
                "Minecraft Preview wurde auf diesem PC nicht gefunden.".to_string(),
            )));
        }

        launch_windows_store_app("Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe!Game")
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(CommandError::from(AppError::UnsupportedOS(
            "Minecraft Preview wird hier nur auf Windows erkannt.".to_string(),
        )))
    }
}

#[tauri::command]
pub async fn list_bedrock_profiles() -> Result<Vec<BedrockProfile>, CommandError> {
    ensure_dir(&bedrock_profiles_root())?;
    let mut profiles = Vec::new();

    for entry in fs::read_dir(bedrock_profiles_root()).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        if !entry.file_type().map_err(AppError::from)?.is_dir() {
            continue;
        }

        let metadata_path = entry.path().join("profile.json");
        if metadata_path.exists() {
            let profile: BedrockProfile =
                serde_json::from_str(&fs::read_to_string(metadata_path).map_err(AppError::from)?)
                    .map_err(AppError::from)?;
            profiles.push(profile);
        }
    }

    profiles.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(profiles)
}

#[tauri::command]
pub async fn create_bedrock_profile(input: CreateBedrockProfileInput) -> Result<BedrockProfile, CommandError> {
    if input.name.trim().is_empty() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Profilname fehlt.".to_string(),
        )));
    }

    let target = normalize_bedrock_target(input.target.as_deref())?;
    let profile = BedrockProfile {
        id: Uuid::new_v4().to_string(),
        name: input.name.trim().to_string(),
        icon_path: input.icon_path.filter(|value| !value.trim().is_empty()),
        target,
        created_at: chrono::Utc::now().to_rfc3339(),
        last_launched_at: None,
        installed_content: Vec::new(),
    };

    ensure_bedrock_profile_dirs(&profile.id)?;
    write_bedrock_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
pub async fn update_bedrock_profile(
    profile_id: String,
    input: UpdateBedrockProfileInput,
) -> Result<BedrockProfile, CommandError> {
    let mut profile = read_bedrock_profile(&profile_id)?;

    if let Some(name) = input.name.filter(|value| !value.trim().is_empty()) {
        profile.name = name.trim().to_string();
    }
    if let Some(icon_path) = input.icon_path {
        profile.icon_path = if icon_path.trim().is_empty() {
            None
        } else {
            Some(icon_path)
        };
    }
    if let Some(target) = input.target {
        profile.target = normalize_bedrock_target(Some(&target))?;
    }

    write_bedrock_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
pub async fn delete_bedrock_profile(profile_id: String) -> Result<(), CommandError> {
    let dir = bedrock_profile_dir(&profile_id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(AppError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn launch_bedrock_profile(profile_id: String) -> Result<BedrockProfile, CommandError> {
    let mut profile = read_bedrock_profile(&profile_id)?;
    profile.last_launched_at = Some(chrono::Utc::now().to_rfc3339());
    write_bedrock_profile(&profile)?;

    match profile.target.as_str() {
        "preview" => open_minecraft_bedrock_preview().await?,
        _ => open_minecraft_bedrock().await?,
    }

    Ok(profile)
}

#[tauri::command]
pub async fn list_bedrock_instances() -> Result<Vec<BedrockInstance>, CommandError> {
    let system = System::new_all();
    let mut instances = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let process_name = process.name().to_string_lossy().to_lowercase();
            let executable = process
                .exe()
                .map(|path| path.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let is_bedrock = process_name.contains("minecraft.windows")
                || executable.contains("minecraft.windows")
                || executable.contains("microsoft.minecraftuwp");
            if !is_bedrock {
                return None;
            }

            let is_preview = executable.contains("minecraftwindowsbeta")
                || executable.contains("minecraft preview")
                || process_name.contains("preview");
            let target = if is_preview { "preview" } else { "release" };
            Some(BedrockInstance {
                id: format!("bedrock-{}", pid.as_u32()),
                name: if is_preview { "Minecraft Preview" } else { "Minecraft Bedrock" }.to_string(),
                target: target.to_string(),
                pid: pid.as_u32(),
                started_at: process.start_time(),
            })
        })
        .collect::<Vec<_>>();
    instances.sort_by_key(|instance| instance.started_at);
    Ok(instances)
}

#[tauri::command]
pub async fn stop_bedrock_instance(pid: u32) -> Result<(), CommandError> {
    let system = System::new_all();
    let process = system.process(Pid::from_u32(pid)).ok_or_else(|| {
        CommandError::from(AppError::InvalidInput("Bedrock-Instanz wurde nicht gefunden.".to_string()))
    })?;
    process
        .kill_with(Signal::Kill)
        .or_else(|| Some(process.kill()))
        .filter(|stopped| *stopped)
        .ok_or_else(|| CommandError::from(AppError::ProcessSpawnFailed("Bedrock konnte nicht beendet werden.".to_string())))?;
    Ok(())
}

#[tauri::command]
pub async fn import_bedrock_profile_content(
    profile_id: String,
    source_path: String,
    kind: String,
) -> Result<BedrockProfile, CommandError> {
    let mut profile = read_bedrock_profile(&profile_id)?;
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Die importierte Bedrock-Datei wurde nicht gefunden.".to_string(),
        )));
    }

    validate_bedrock_content_kind(&kind)?;
    validate_bedrock_content_extension(&source, &kind)?;

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput("Dateiname fehlt.".to_string()))?
        .to_string();
    let target = bedrock_content_dir(&profile_id, &kind).join(&file_name);
    ensure_dir(target.parent().unwrap_or_else(|| Path::new(".")))?;
    fs::copy(&source, &target).map_err(AppError::from)?;

    let imported_at = chrono::Utc::now().to_rfc3339();
    profile.installed_content.retain(|item| !(item.kind == kind && item.file_name == file_name));
    profile.installed_content.push(BedrockInstalledContent {
        name: file_name.clone(),
        source: "local".to_string(),
        file_name,
        kind,
        path: target.to_string_lossy().to_string(),
        imported_at,
    });
    write_bedrock_profile(&profile)?;

    if should_open_bedrock_content(&target) {
        open_path_with_shell(&target)?;
    }

    Ok(profile)
}

#[tauri::command]
pub async fn install_bedrock_skin_pack(input: InstallBedrockSkinPackInput) -> Result<String, CommandError> {
    if input.name.trim().is_empty() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Skinname fehlt.".to_string(),
        )));
    }

    let encoded_skin = input
        .base64_data
        .split(',')
        .last()
        .unwrap_or(input.base64_data.as_str())
        .trim();
    let skin_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_skin)
        .map_err(|error| AppError::InvalidInput(format!("Skin konnte nicht gelesen werden: {error}")))?;
    let skin_name = sanitize_file_name(input.name.trim(), "bedrock-skin");
    let pack_dir = bedrock_skinpacks_root();
    ensure_dir(&pack_dir)?;
    let pack_path = pack_dir.join(format!("{skin_name}.mcpack"));

    write_bedrock_skin_pack(&pack_path, &skin_name, &input.variant, &skin_bytes)?;
    open_path_with_shell(&pack_path)?;
    Ok(pack_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn search_bedrock_catalog(
    query: String,
    kind: String,
) -> Result<Vec<BedrockCatalogResult>, CommandError> {
    let class_id = match kind.as_str() {
        "addon" => 4984,
        "resourcepack" => 6929,
        "world" => 6913,
        "skinpack" => 6925,
        _ => 4984,
    };
    let response = search_mods(
        78022,
        Some(query),
        Some(class_id),
        None,
        None,
        Some(CurseForgeModSearchSortField::Popularity),
        Some(CurseForgeSortOrder::Desc),
        None,
        None,
        Some(0),
        Some(30),
    )
    .await
    .map_err(CommandError::from)?;

    Ok(response
        .data
        .into_iter()
        .map(|project| BedrockCatalogResult {
            project_id: project.id.to_string(),
            title: project.name,
            description: project.summary,
            icon_url: project.logo.map(|logo| logo.url),
            downloads: project.downloadCount,
            author: project.authors.first().map(|author| author.name.clone()),
            project_url: project.links.websiteUrl,
            download_available: project
                .latestFiles
                .iter()
                .any(|file| file.isAvailable && !file.downloadUrl.trim().is_empty()),
        })
        .collect())
}

#[tauri::command]
pub async fn install_bedrock_catalog_project(
    profile_id: String,
    project_id: String,
    kind: String,
) -> Result<BedrockProfile, CommandError> {
    let parsed_project_id = project_id.parse::<u32>().map_err(|_| {
        CommandError::from(AppError::InvalidInput("Ungültige CurseForge-Projekt-ID.".to_string()))
    })?;
    let files = get_mod_files(parsed_project_id, None, None, None, Some(0), Some(50))
        .await
        .map_err(CommandError::from)?;
    let file = files
        .data
        .into_iter()
        .find(|file| file.isAvailable && !file.downloadUrl.trim().is_empty())
        .ok_or_else(|| CommandError::from(AppError::NotFound("CurseForge stellt für dieses Projekt keinen direkten Download bereit.".to_string())))?;

    let response = HTTP_CLIENT
        .get(&file.downloadUrl)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| AppError::Other(format!("Bedrock-Inhalt konnte nicht heruntergeladen werden: {error}")))?;
    if !response.status().is_success() {
        return Err(CommandError::from(AppError::Other(format!(
            "CurseForge-Download fehlgeschlagen: {}",
            response.status()
        ))));
    }
    let bytes = response.bytes().await.map_err(|error| AppError::Other(error.to_string()))?;
    let target_dir = bedrock_content_dir(&profile_id, &kind);
    ensure_dir(&target_dir)?;
    let file_name = sanitize_file_name(&file.fileName, "bedrock-content.mcpack");
    let target = target_dir.join(&file_name);
    fs::write(&target, bytes).map_err(AppError::from)?;
    validate_bedrock_content_kind(&kind)?;
    validate_bedrock_content_extension(&target, &kind)?;

    let mut profile = read_bedrock_profile(&profile_id)?;
    profile.installed_content.retain(|item| !(item.kind == kind && item.file_name == file_name));
    profile.installed_content.push(BedrockInstalledContent {
        name: file.displayName,
        source: "curseforge".to_string(),
        file_name,
        kind,
        path: target.to_string_lossy().to_string(),
        imported_at: chrono::Utc::now().to_rfc3339(),
    });
    write_bedrock_profile(&profile)?;
    if should_open_bedrock_content(&target) {
        open_path_with_shell(&target)?;
    }
    Ok(profile)
}

#[tauri::command]
pub async fn update_local_server_settings(
    server_id: String,
    settings: UpdateLocalServerSettingsInput,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let previous_minecraft_version = server.minecraft_version.clone();
    let previous_loader_version = server.loader_version.clone();
    let previous_server_type = server.server_type.clone();

    if let Some(name) = settings.name.filter(|value| !value.trim().is_empty()) {
        server.name = name.trim().to_string();
    }
    if let Some(server_type) = settings.server_type.filter(|value| !value.trim().is_empty()) {
        validate_server_type(&server_type)?;
        server.server_type = server_type.trim().to_string();
        if previous_server_type != server.server_type {
            server.server_kind = kind_for_loader(&server.server_type).to_string();
            if !loader_version_server_type(&server.server_type) {
                server.loader_version = None;
            }
        }
    }
    if let Some(version) = settings.minecraft_version.filter(|value| !value.trim().is_empty()) {
        server.minecraft_version = version.trim().to_string();
    }
    if let Some(loader_version) = settings.loader_version {
        server.loader_version = if loader_version.trim().is_empty() {
            None
        } else {
            Some(loader_version.trim().to_string())
        };
    }
    if let Some(server_ip) = settings.server_ip {
        server.server_ip = if server_ip.trim().is_empty() {
            None
        } else {
            Some(server_ip.trim().to_string())
        };
    }
    if let Some(port) = settings.port {
        server.port = port;
    }
    if let Some(ram_mb) = settings.ram_mb {
        if ram_mb < 512 {
            return Err(CommandError::from(AppError::InvalidInput(
                "RAM muss mindestens 512 MB sein.".to_string(),
            )));
        }
        server.ram_mb = ram_mb;
    }
    if let Some(java_path) = settings.java_path {
        server.java_path = if java_path.trim().is_empty() {
            None
        } else {
            Some(java_path.trim().to_string())
        };
    }
    if let Some(kind) = settings.server_kind.filter(|value| !value.trim().is_empty()) {
        server.server_kind = kind;
    }
    if let Some(description) = settings.description {
        server.description = if description.trim().is_empty() {
            None
        } else {
            Some(description)
        };
    }
    if let Some(icon_path) = settings.icon_path {
        server.icon_path = if icon_path.trim().is_empty() {
            None
        } else {
            Some(icon_path)
        };
    }
    if let Some(codex_enabled) = settings.codex_enabled {
        server.codex_enabled = codex_enabled;
    }
    if let Some(port) = settings.codex_mcp_port {
        server.codex_mcp_port = Some(port);
    }
    if let Some(auto_update) = settings.auto_update_content {
        server.auto_update_content = auto_update;
    }

    let runtime_changed =
        previous_minecraft_version != server.minecraft_version ||
        previous_loader_version != server.loader_version ||
        previous_server_type != server.server_type;
    if runtime_changed && is_running(&server_id) {
        return Err(CommandError::from(AppError::InvalidInput(
            "Stoppe den Server, bevor du Version oder Loader wechselst.".to_string(),
        )));
    }

    write_server_properties(&server)?;
    if runtime_changed {
        ensure_server_runtime_dirs(&server_dir(&server.id), &server.server_type)?;
        match server.server_type.as_str() {
            "paper" | "spigot" | "bukkit" => download_paper_server(&server).await?,
            "fabric" => download_fabric_server(&mut server).await?,
            "forge" => install_forge_server(&mut server).await?,
            "neoforge" => install_neoforge_server(&mut server).await?,
            "vanilla" => download_vanilla_server(&server).await?,
            "bedrock" => download_bedrock_server(&mut server).await?,
            _ => unreachable!("validated server type"),
        }
    }
    write_server_metadata(&server)?;
    write_codex_metadata(&server)?;
    sync_server_icon(&server).await?;
    Ok(server)
}

#[tauri::command]
pub async fn start_local_server(app: AppHandle, server_id: String) -> Result<LocalServer, CommandError> {
    if is_running(&server_id) {
        return read_server_metadata(&server_id);
    }

    let mut server = read_server_metadata(&server_id)?;
    let mut command = server_start_command(&server)?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;

    if let Some(stdout) = child.stdout.take() {
        pipe_process_output(app.clone(), server_id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_process_output(app.clone(), server_id.clone(), "stderr", stderr);
    }

    RUNNING_SERVERS
        .lock()
        .map_err(|_| AppError::ProcessError("Server process lock failed".to_string()))?
        .insert(server_id.clone(), child);

    server.status = "running".to_string();
    server.last_started_at = Some(chrono::Utc::now().to_rfc3339());
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn stop_local_server(server_id: String) -> Result<LocalServer, CommandError> {
    if let Some(mut child) = RUNNING_SERVERS
        .lock()
        .map_err(|_| AppError::ProcessError("Server process lock failed".to_string()))?
        .remove(&server_id)
    {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"stop\n");
            for _ in 0..40 {
                if child.try_wait().map_err(AppError::from)?.is_some() {
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(250));
            }
            if child.try_wait().map_err(AppError::from)?.is_none() {
                let _ = child.kill();
            }
        } else {
            let _ = child.kill();
        }
    }

    let mut server = read_server_metadata(&server_id)?;
    server.status = "stopped".to_string();
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn restart_local_server(app: AppHandle, server_id: String) -> Result<LocalServer, CommandError> {
    let _ = stop_local_server(server_id.clone()).await?;
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    start_local_server(app, server_id).await
}

#[tauri::command]
pub async fn send_local_server_command(server_id: String, command: String) -> Result<(), CommandError> {
    let mut running = RUNNING_SERVERS
        .lock()
        .map_err(|_| AppError::ProcessError("Server process lock failed".to_string()))?;
    let child = running
        .get_mut(&server_id)
        .ok_or_else(|| AppError::ProcessNotFound(Uuid::nil()))?;
    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| AppError::ProcessError("Server stdin is closed".to_string()))?;
    stdin
        .write_all(format!("{}\n", command).as_bytes())
        .map_err(AppError::from)?;
    Ok(())
}

#[tauri::command]
pub async fn read_local_server_log(server_id: String) -> Result<String, CommandError> {
    let log_path = server_dir(&server_id).join("logs").join("latest.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(log_path).map_err(AppError::from).map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_local_server_path(
    server_id: String,
    relative_path: Option<String>,
) -> Result<String, CommandError> {
    Ok(resolve_server_path(&server_id, relative_path.as_deref().unwrap_or(""))?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn list_local_server_files(
    server_id: String,
    relative_path: Option<String>,
) -> Result<Vec<LocalServerFileEntry>, CommandError> {
    let base = resolve_server_path(&server_id, relative_path.as_deref().unwrap_or(""))?;
    if !base.is_dir() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Der ausgewählte Pfad ist kein Ordner.".to_string(),
        )));
    }

    let root = server_dir(&server_id);
    let mut entries = Vec::new();
    for entry in fs::read_dir(&base).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        let metadata = entry.metadata().map_err(AppError::from)?;
        let path = entry.path();
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(LocalServerFileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            relative_path: relative,
            absolute_path: path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size_bytes: if metadata.is_file() { metadata.len() } else { 0 },
            modified_at: metadata
                .modified()
                .ok()
                .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
        });
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
pub async fn read_local_server_file(
    server_id: String,
    relative_path: String,
) -> Result<String, CommandError> {
    let path = resolve_server_path(&server_id, &relative_path)?;
    if !path.is_file() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Die ausgewählte Datei kann nicht geöffnet werden.".to_string(),
        )));
    }
    let metadata = path.metadata().map_err(AppError::from)?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err(CommandError::from(AppError::InvalidInput(
            "Datei ist zu groß für den In-App-Editor.".to_string(),
        )));
    }
    let bytes = fs::read(path).map_err(AppError::from)?;
    String::from_utf8(bytes).map_err(|_| {
        CommandError::from(AppError::InvalidInput(
            "Diese Datei ist keine Textdatei.".to_string(),
        ))
    })
}

#[tauri::command]
pub async fn write_local_server_file(
    server_id: String,
    relative_path: String,
    contents: String,
) -> Result<LocalServer, CommandError> {
    if contents.len() > 2 * 1024 * 1024 {
        return Err(CommandError::from(AppError::InvalidInput(
            "Datei ist zu groß für den In-App-Editor.".to_string(),
        )));
    }
    let path = resolve_server_path(&server_id, &relative_path)?;
    if path.is_dir() {
        return Err(CommandError::from(AppError::InvalidInput(
            "Ordner können nicht als Datei gespeichert werden.".to_string(),
        )));
    }
    fs::write(&path, contents).map_err(AppError::from)?;

    let mut server = read_server_metadata(&server_id)?;
    if relative_path.replace('\\', "/") == "server.properties" {
        let properties = read_properties_map(&path).map_err(CommandError::from)?;
        sync_server_from_properties(&mut server, &properties);
        write_server_metadata(&server)?;
    }
    Ok(server)
}

#[tauri::command]
pub async fn read_local_server_properties(
    server_id: String,
) -> Result<BTreeMap<String, String>, CommandError> {
    read_properties_map(&server_dir(&server_id).join("server.properties"))
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn write_local_server_properties(
    server_id: String,
    properties: BTreeMap<String, String>,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    write_properties_map(&server_dir(&server_id).join("server.properties"), &properties)?;
    sync_server_from_properties(&mut server, &properties);

    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn list_local_server_backups(server_id: String) -> Result<Vec<ServerBackup>, CommandError> {
    let backups_dir = server_dir(&server_id).join("backups");
    ensure_dir(&backups_dir)?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(backups_dir).map_err(AppError::from)? {
        let entry = entry.map_err(AppError::from)?;
        if !entry.file_type().map_err(AppError::from)?.is_dir() {
            continue;
        }
        let metadata = entry.metadata().map_err(AppError::from)?;
        let created_at = metadata
            .created()
            .ok()
            .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        backups.push(ServerBackup {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            created_at,
        });
    }

    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

#[tauri::command]
pub async fn create_local_server_backup(server_id: String) -> Result<ServerBackup, CommandError> {
    let server = read_server_metadata(&server_id)?;
    let backup_name = format!(
        "{}-{}",
        sanitize_file_name(&server.name, "server"),
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    let backup_path = server_dir(&server_id).join("backups").join(&backup_name);
    ensure_dir(&backup_path)?;
    copy_dir_contents_for_backup(&server_dir(&server_id), &backup_path)?;

    Ok(ServerBackup {
        name: backup_name,
        path: backup_path.to_string_lossy().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn invite_local_server_user(
    server_id: String,
    name: String,
) -> Result<LocalServer, CommandError> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(CommandError::from(AppError::InvalidInput("Name fehlt.".to_string())));
    }

    let mut server = read_server_metadata(&server_id)?;
    if !server.invited_users.iter().any(|user| user.name.eq_ignore_ascii_case(clean_name)) {
        server.invited_users.push(ServerUser {
            name: clean_name.to_string(),
            role: "Member".to_string(),
            invited_at: chrono::Utc::now().to_rfc3339(),
        });
        write_server_metadata(&server)?;
    }
    Ok(server)
}

#[tauri::command]
pub async fn create_local_server_database(
    server_id: String,
    name: Option<String>,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let database_dir = server_dir(&server_id).join("database");
    ensure_dir(&database_dir)?;
    let clean_name = sanitize_file_name(
        name.unwrap_or_else(|| "server.sqlite".to_string()).trim(),
        "server.sqlite",
    );
    let file_name = if clean_name.ends_with(".sqlite") || clean_name.ends_with(".db") {
        clean_name
    } else {
        format!("{clean_name}.sqlite")
    };
    let database_path = database_dir.join(file_name);
    if !database_path.exists() {
        fs::File::create(&database_path).map_err(AppError::from)?;
    }

    server.database = Some(ServerDatabase {
        enabled: true,
        database_type: "SQLite".to_string(),
        name: database_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("server.sqlite")
            .to_string(),
        path: Some(database_path.to_string_lossy().to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn install_local_server_file(
    server_id: String,
    source_path: String,
    kind: String,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let source = PathBuf::from(&source_path);
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("");
    if matches!(kind.as_str(), "plugin" | "mod") && !extension.eq_ignore_ascii_case("jar") {
        return Err(CommandError::from(AppError::InvalidInput(
            "Plugins und Mods müssen .jar Dateien sein.".to_string(),
        )));
    }
    if kind == "resourcepack" && !extension.eq_ignore_ascii_case("zip") {
        return Err(CommandError::from(AppError::InvalidInput(
            "Resourcepacks müssen .zip Dateien sein.".to_string(),
        )));
    }

    if matches!(kind.as_str(), "shaderpack" | "datapack") && !extension.eq_ignore_ascii_case("zip") {
        return Err(CommandError::from(AppError::InvalidInput(
            "Shaderpacks und Datapacks muessen .zip Dateien sein.".to_string(),
        )));
    }

    if kind == "modpack"
        && !extension.eq_ignore_ascii_case("mrpack")
        && !extension.eq_ignore_ascii_case("zip")
    {
        return Err(CommandError::from(AppError::InvalidInput(
            "Modpacks muessen .mrpack oder .zip Dateien sein.".to_string(),
        )));
    }

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput("Dateiname fehlt.".to_string()))?
        .to_string();
    let target = content_dir(&server_id, &kind).join(&file_name);
    ensure_dir(target.parent().unwrap_or_else(|| Path::new(".")))?;
    fs::copy(&source, &target).map_err(AppError::from)?;

    server.installed_content.push(InstalledContent {
        name: file_name.clone(),
        source: "local".to_string(),
        project_id: None,
        file_name,
        kind,
        version: None,
        enabled: true,
    });
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn search_local_server_catalog(
    input: ServerCatalogSearchInput,
) -> Result<Vec<ServerCatalogResult>, CommandError> {
    let project_type = match input.kind.as_str() {
        "resourcepack" => "resourcepack",
        "modpack" => "modpack",
        "shaderpack" => "shader",
        "datapack" => "datapack",
        "plugin" => "plugin",
        _ => "mod",
    };
    let facets = if matches!(input.kind.as_str(), "resourcepack" | "modpack" | "shaderpack" | "datapack") {
        serde_json::json!([[format!("project_type:{project_type}")], [format!("versions:{}", input.minecraft_version)]])
    } else {
        let loader_facets: Vec<String> = catalog_loader_facets(&input.kind, &input.loader)
            .into_iter()
            .map(|loader| format!("categories:{loader}"))
            .collect();
        serde_json::json!([[format!("project_type:{project_type}")], [format!("versions:{}", input.minecraft_version)], loader_facets])
    };
    let client = reqwest::Client::new();
    let response: Value = client
        .get("https://api.modrinth.com/v2/search")
        .header("User-Agent", USER_AGENT)
        .query(&[
            ("query", input.query),
            ("limit", "24".to_string()),
            ("facets", facets.to_string()),
        ])
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    let hits = response["hits"].as_array().cloned().unwrap_or_default();
    Ok(hits
        .into_iter()
        .map(|hit| ServerCatalogResult {
            project_id: hit["project_id"].as_str().unwrap_or_default().to_string(),
            title: hit["title"].as_str().unwrap_or("Unknown").to_string(),
            description: hit["description"].as_str().unwrap_or_default().to_string(),
            icon_url: hit["icon_url"].as_str().map(ToString::to_string),
            downloads: hit["downloads"].as_u64().unwrap_or(0),
            project_type: hit["project_type"].as_str().unwrap_or(project_type).to_string(),
        })
        .collect())
}

#[tauri::command]
pub async fn install_local_server_catalog_project(
    server_id: String,
    project_id: String,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let client = reqwest::Client::new();
    let project: Value = client
        .get(format!("https://api.modrinth.com/v2/project/{project_id}"))
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;
    let kind = match project["project_type"].as_str().unwrap_or("mod") {
        "resourcepack" => "resourcepack",
        "modpack" => "modpack",
        "shader" => "shaderpack",
        "datapack" => "datapack",
        "plugin" => "plugin",
        _ => "mod",
    };
    let mut url = reqwest::Url::parse(&format!("https://api.modrinth.com/v2/project/{project_id}/version"))
        .map_err(|error| AppError::RequestError(error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("game_versions", &serde_json::json!([server.minecraft_version]).to_string());
    let loaders = modrinth_loaders_for_server(&server.server_type, kind);
    if !loaders.is_empty() {
        url.query_pairs_mut()
            .append_pair("loaders", &serde_json::json!(loaders).to_string());
    }

    let versions: Value = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;
    let version = versions
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| AppError::NotFound("Keine passende Modrinth-Version gefunden.".to_string()))?;
    let file = version["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|file| file["primary"].as_bool().unwrap_or(false))
                .or_else(|| files.first())
        })
        .ok_or_else(|| AppError::NotFound("Keine passende Modrinth-Datei gefunden.".to_string()))?;
    let download_url = file["url"]
        .as_str()
        .ok_or_else(|| AppError::Download("Modrinth-Datei hat keine URL.".to_string()))?;
    let file_name = file["filename"].as_str().unwrap_or("download.jar").to_string();
    let bytes = client
        .get(download_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .bytes()
        .await
        .map_err(AppError::from)?;
    fs::write(content_dir(&server_id, kind).join(&file_name), bytes).map_err(AppError::from)?;

    server.installed_content.push(InstalledContent {
        name: file_name.clone(),
        source: "modrinth".to_string(),
        project_id: Some(project_id),
        file_name,
        kind: kind.to_string(),
        version: version["version_number"].as_str().map(ToString::to_string),
        enabled: true,
    });
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn set_local_server_content_enabled(
    server_id: String,
    file_name: String,
    kind: String,
    enabled: bool,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let item = server
        .installed_content
        .iter_mut()
        .find(|item| item.kind == kind && item.file_name == file_name)
        .ok_or_else(|| AppError::NotFound("Content nicht gefunden.".to_string()))?;

    let current_path = content_file_path(&server_id, &item.kind, &item.file_name, item.enabled);
    let target_path = content_file_path(&server_id, &item.kind, &item.file_name, enabled);
    ensure_dir(target_path.parent().unwrap_or_else(|| Path::new(".")))?;

    if current_path != target_path && current_path.exists() {
        if target_path.exists() {
            fs::remove_file(&target_path).map_err(AppError::from)?;
        }
        fs::rename(&current_path, &target_path).map_err(AppError::from)?;
    }

    item.enabled = enabled;
    write_server_metadata(&server)?;
    Ok(server)
}

#[tauri::command]
pub async fn delete_local_server_content(
    server_id: String,
    file_name: String,
    kind: String,
) -> Result<LocalServer, CommandError> {
    let mut server = read_server_metadata(&server_id)?;
    let enabled_path = content_file_path(&server_id, &kind, &file_name, true);
    let disabled_path = content_file_path(&server_id, &kind, &file_name, false);

    if enabled_path.exists() {
        fs::remove_file(&enabled_path).map_err(AppError::from)?;
    }
    if disabled_path.exists() {
        fs::remove_file(&disabled_path).map_err(AppError::from)?;
    }

    server
        .installed_content
        .retain(|item| !(item.kind == kind && item.file_name == file_name));
    write_server_metadata(&server)?;
    Ok(server)
}

fn servers_root() -> PathBuf {
    if let Ok(path) = std::env::var("NRC_LOCAL_SERVERS_DIR") {
        return PathBuf::from(path);
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("nrc-local-servers")
}

fn server_dir(server_id: &str) -> PathBuf {
    servers_root().join(server_id)
}

fn bedrock_profiles_root() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("bedrock-profiles")
}

fn bedrock_profile_dir(profile_id: &str) -> PathBuf {
    bedrock_profiles_root().join(profile_id)
}

fn bedrock_profile_metadata_path(profile_id: &str) -> PathBuf {
    bedrock_profile_dir(profile_id).join("profile.json")
}

fn bedrock_content_dir(profile_id: &str, kind: &str) -> PathBuf {
    match kind {
        "addon" => bedrock_profile_dir(profile_id).join("addons"),
        "resourcepack" => bedrock_profile_dir(profile_id).join("resourcepacks"),
        "world" => bedrock_profile_dir(profile_id).join("worlds"),
        "skinpack" => bedrock_profile_dir(profile_id).join("skinpacks"),
        _ => bedrock_profile_dir(profile_id).join("content"),
    }
}

fn bedrock_skinpacks_root() -> PathBuf {
    bedrock_profiles_root().join("_skinpacks")
}

fn ensure_bedrock_profile_dirs(profile_id: &str) -> Result<(), AppError> {
    ensure_dir(&bedrock_profile_dir(profile_id))?;
    ensure_dir(&bedrock_content_dir(profile_id, "addon"))?;
    ensure_dir(&bedrock_content_dir(profile_id, "resourcepack"))?;
    ensure_dir(&bedrock_content_dir(profile_id, "world"))?;
    ensure_dir(&bedrock_content_dir(profile_id, "skinpack"))
}

fn read_bedrock_profile(profile_id: &str) -> Result<BedrockProfile, CommandError> {
    let path = bedrock_profile_metadata_path(profile_id);
    if !path.exists() {
        return Err(CommandError::from(AppError::NotFound(
            "Bedrock-Profil wurde nicht gefunden.".to_string(),
        )));
    }

    serde_json::from_str(&fs::read_to_string(path).map_err(AppError::from)?)
        .map_err(AppError::from)
        .map_err(CommandError::from)
}

fn write_bedrock_profile(profile: &BedrockProfile) -> Result<(), CommandError> {
    ensure_bedrock_profile_dirs(&profile.id)?;
    let json = serde_json::to_string_pretty(profile).map_err(AppError::from)?;
    fs::write(bedrock_profile_metadata_path(&profile.id), json).map_err(AppError::from)?;
    Ok(())
}

fn normalize_bedrock_target(target: Option<&str>) -> Result<String, CommandError> {
    match target.unwrap_or("release").trim().to_lowercase().as_str() {
        "" | "release" => Ok("release".to_string()),
        "preview" => Ok("preview".to_string()),
        _ => Err(CommandError::from(AppError::InvalidInput(
            "Bedrock-Ziel muss Release oder Preview sein.".to_string(),
        ))),
    }
}

fn validate_bedrock_content_kind(kind: &str) -> Result<(), CommandError> {
    if matches!(kind, "addon" | "resourcepack" | "world" | "skinpack") {
        Ok(())
    } else {
        Err(CommandError::from(AppError::InvalidInput(
            "Bedrock-Inhalt muss Add-on, Resourcepack, Welt oder Skinpack sein.".to_string(),
        )))
    }
}

fn validate_bedrock_content_extension(source: &Path, kind: &str) -> Result<(), CommandError> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let valid = match kind {
        "addon" => matches!(extension.as_str(), "mcaddon" | "mcpack" | "zip"),
        "resourcepack" => matches!(extension.as_str(), "mcpack" | "zip"),
        "world" => matches!(extension.as_str(), "mcworld" | "zip"),
        "skinpack" => matches!(extension.as_str(), "mcpack"),
        _ => false,
    };

    if valid {
        Ok(())
    } else {
        Err(CommandError::from(AppError::InvalidInput(
            "Diese Datei passt nicht zum ausgewaehlten Bedrock-Inhalt.".to_string(),
        )))
    }
}

fn should_open_bedrock_content(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension.to_lowercase().as_str(), "mcpack" | "mcaddon" | "mcworld"))
        .unwrap_or(false)
}

fn open_path_with_shell(path: &Path) -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd.exe");
        command.args(["/C", "start", ""]);
        command.arg(path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;
        Ok(())
    }
}

fn write_bedrock_skin_pack(
    pack_path: &Path,
    skin_name: &str,
    variant: &str,
    skin_bytes: &[u8],
) -> Result<(), CommandError> {
    let serialize_name = sanitize_file_name(skin_name, "bedrock_skin")
        .replace(' ', "_")
        .to_lowercase();
    let geometry = if variant.eq_ignore_ascii_case("slim") {
        "geometry.humanoid.customSlim"
    } else {
        "geometry.humanoid.custom"
    };
    let manifest = serde_json::json!({
        "format_version": 1,
        "header": {
            "name": skin_name,
            "uuid": Uuid::new_v4().to_string(),
            "version": [1, 0, 0]
        },
        "modules": [
            {
                "type": "skin_pack",
                "uuid": Uuid::new_v4().to_string(),
                "version": [1, 0, 0]
            }
        ]
    });
    let skins = serde_json::json!({
        "serialize_name": serialize_name,
        "localization_name": serialize_name,
        "skins": [
            {
                "localization_name": serialize_name,
                "geometry": geometry,
                "texture": "skin.png",
                "type": "free"
            }
        ]
    });
    let lang = format!(
        "skinpack.{}.name={}\nskin.{}.{}.name={}\n",
        serialize_name, skin_name, serialize_name, serialize_name, skin_name
    );

    let file = fs::File::create(pack_path).map_err(AppError::from)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);

    zip.start_file("manifest.json", options).map_err(AppError::from)?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(AppError::from)?.as_bytes())
        .map_err(AppError::from)?;
    zip.start_file("skins.json", options).map_err(AppError::from)?;
    zip.write_all(serde_json::to_string_pretty(&skins).map_err(AppError::from)?.as_bytes())
        .map_err(AppError::from)?;
    zip.start_file("skin.png", options).map_err(AppError::from)?;
    zip.write_all(skin_bytes).map_err(AppError::from)?;
    zip.start_file("texts/en_US.lang", options).map_err(AppError::from)?;
    zip.write_all(lang.as_bytes()).map_err(AppError::from)?;
    zip.start_file("texts/languages.json", options).map_err(AppError::from)?;
    zip.write_all(b"[\"en_US\"]").map_err(AppError::from)?;
    zip.finish().map_err(AppError::from)?;
    Ok(())
}

fn content_dir(server_id: &str, kind: &str) -> PathBuf {
    match kind {
        "plugin" => server_dir(server_id).join("plugins"),
        "mod" => server_dir(server_id).join("mods"),
        "resourcepack" => server_dir(server_id).join("resourcepacks"),
        "modpack" => server_dir(server_id).join("modpacks"),
        "shaderpack" => server_dir(server_id).join("shaderpacks"),
        "datapack" => server_dir(server_id).join("datapacks"),
        _ => server_dir(server_id),
    }
}

fn content_file_path(server_id: &str, kind: &str, file_name: &str, enabled: bool) -> PathBuf {
    if enabled {
        content_dir(server_id, kind).join(file_name)
    } else {
        content_dir(server_id, kind).join(format!("{file_name}.disabled"))
    }
}

fn server_type_for_profile(profile: &Profile) -> String {
    match profile.loader {
        ModLoader::Fabric => "fabric".to_string(),
        ModLoader::Forge => "forge".to_string(),
        ModLoader::NeoForge => "neoforge".to_string(),
        ModLoader::Vanilla => "vanilla".to_string(),
        _ => "paper".to_string(),
    }
}

async fn profile_icon_value(profile: &Profile, state: &State) -> Option<String> {
    let banner = profile.banner.as_ref()?;
    match &banner.source {
        ImageSource::Url { url } => Some(url.clone()),
        ImageSource::AbsolutePath { path } => Some(path.clone()),
        ImageSource::RelativePath { path } => Some(LAUNCHER_DIRECTORY.root_dir().join(path).to_string_lossy().to_string()),
        ImageSource::RelativeProfile { path } => state
            .profile_manager
            .get_profile_instance_path(profile.id)
            .await
            .ok()
            .map(|profile_path| profile_path.join(path).to_string_lossy().to_string()),
        ImageSource::Base64 { .. } => None,
    }
}

fn copy_profile_content(profile: &Profile, state: &State, server: &mut LocalServer) -> Result<(), AppError> {
    if matches!(profile.loader, ModLoader::Fabric | ModLoader::Forge | ModLoader::NeoForge) {
        let mods_path = state.profile_manager.get_profile_mods_path(profile)?;
        copy_profile_content_dir(&mods_path, &content_dir(&server.id, "mod"), "mod", server, Some(&profile.mods))?;
    }

    let profile_root = state.profile_manager.calculate_instance_path_for_profile(profile)?;
    copy_profile_content_dir(&profile_root.join("resourcepacks"), &content_dir(&server.id, "resourcepack"), "resourcepack", server, None)?;
    copy_profile_content_dir(&profile_root.join("shaderpacks"), &content_dir(&server.id, "shaderpack"), "shaderpack", server, None)?;
    copy_profile_content_dir(&profile_root.join("datapacks"), &content_dir(&server.id, "datapack"), "datapack", server, None)?;
    Ok(())
}

fn copy_profile_content_dir(
    source_dir: &Path,
    target_dir: &Path,
    kind: &str,
    server: &mut LocalServer,
    profile_mods: Option<&[Mod]>,
) -> Result<(), AppError> {
    if !source_dir.exists() || !source_dir.is_dir() {
        return Ok(());
    }

    ensure_dir(target_dir)?;
    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let source_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !content_file_matches_kind(&file_name, kind) {
            continue;
        }

        let (metadata_file_name, enabled) = normalized_content_file_name(&file_name);
        let target_name = if enabled {
            metadata_file_name.clone()
        } else {
            format!("{metadata_file_name}.disabled")
        };
        fs::copy(&source_path, target_dir.join(&target_name))?;

        let matched_mod = profile_mods.and_then(|mods| {
            mods.iter().find(|item| {
                profile_mod_file_name(item)
                    .map(|mod_file_name| mod_file_name.eq_ignore_ascii_case(&metadata_file_name))
                    .unwrap_or(false)
            })
        });

        if server
            .installed_content
            .iter()
            .any(|item| item.kind == kind && item.file_name.eq_ignore_ascii_case(&metadata_file_name))
        {
            continue;
        }

        server.installed_content.push(InstalledContent {
            name: matched_mod
                .and_then(|item| item.display_name.clone())
                .unwrap_or_else(|| metadata_file_name.clone()),
            source: matched_mod
                .map(|item| source_label_for_mod(&item.source).to_string())
                .unwrap_or_else(|| "local".to_string()),
            project_id: matched_mod.and_then(project_id_for_mod),
            file_name: metadata_file_name,
            kind: kind.to_string(),
            version: matched_mod.and_then(|item| item.version.clone()),
            enabled,
        });
    }
    Ok(())
}

fn content_file_matches_kind(file_name: &str, kind: &str) -> bool {
    let lower = file_name.to_lowercase();
    match kind {
        "plugin" | "mod" => lower.ends_with(".jar") || lower.ends_with(".jar.disabled"),
        "resourcepack" | "shaderpack" | "datapack" => lower.ends_with(".zip") || lower.ends_with(".zip.disabled"),
        "modpack" => lower.ends_with(".mrpack") || lower.ends_with(".mrpack.disabled") || lower.ends_with(".zip") || lower.ends_with(".zip.disabled"),
        _ => false,
    }
}

fn normalized_content_file_name(file_name: &str) -> (String, bool) {
    file_name
        .strip_suffix(".disabled")
        .map(|value| (value.to_string(), false))
        .unwrap_or_else(|| (file_name.to_string(), true))
}

fn profile_mod_file_name(item: &Mod) -> Option<String> {
    if let Some(file_name) = &item.file_name_override {
        return Some(file_name.clone());
    }
    match &item.source {
        ModSource::Local { file_name } => Some(file_name.clone()),
        ModSource::Url { file_name, .. } => file_name.clone(),
        ModSource::Modrinth { file_name, .. } => Some(file_name.clone()),
        ModSource::CurseForge { file_name, .. } => Some(file_name.clone()),
        _ => None,
    }
}

fn source_label_for_mod(source: &ModSource) -> &'static str {
    match source {
        ModSource::Modrinth { .. } => "modrinth",
        ModSource::CurseForge { .. } => "curseforge",
        ModSource::Local { .. } => "local",
        ModSource::Url { .. } => "url",
        ModSource::Maven { .. } => "maven",
        ModSource::Embedded { .. } => "embedded",
    }
}

fn project_id_for_mod(item: &Mod) -> Option<String> {
    match &item.source {
        ModSource::Modrinth { project_id, .. } => Some(project_id.clone()),
        ModSource::CurseForge { project_id, .. } => Some(project_id.clone()),
        _ => None,
    }
}

async fn sync_server_icon(server: &LocalServer) -> Result<(), AppError> {
    let Some(icon_path) = server.icon_path.as_deref().filter(|value| !value.starts_with("preset:")) else {
        return Ok(());
    };

    match load_icon_bytes(icon_path).await.and_then(|bytes| encode_server_icon_png(&bytes)) {
        Ok(bytes) => {
            fs::write(server_dir(&server.id).join("server-icon.png"), bytes)?;
        }
        Err(error) => {
            warn!("Konnte Server-Icon fuer '{}' nicht schreiben: {}", server.name, error);
        }
    }
    Ok(())
}

async fn load_icon_bytes(value: &str) -> Result<Vec<u8>, AppError> {
    if value.starts_with("data:") {
        let (_, data) = value
            .split_once(',')
            .ok_or_else(|| AppError::ImageProcessingError("Ungültiges Base64-Bild.".to_string()))?;
        return base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|error| AppError::ImageProcessingError(error.to_string()));
    }

    if value.starts_with("http://") || value.starts_with("https://") {
        return Ok(reqwest::Client::new()
            .get(value)
            .header("User-Agent", USER_AGENT)
            .send()
            .await
            .map_err(AppError::from)?
            .error_for_status()
            .map_err(AppError::from)?
            .bytes()
            .await
            .map_err(AppError::from)?
            .to_vec());
    }

    fs::read(value).map_err(AppError::from)
}

fn encode_server_icon_png(bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| AppError::ImageProcessingError(error.to_string()))?;
    let resized = image.resize_exact(64, 64, FilterType::Nearest);
    let mut cursor = Cursor::new(Vec::new());
    resized
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|error| AppError::ImageProcessingError(error.to_string()))?;
    Ok(cursor.into_inner())
}

fn ensure_server_runtime_dirs(path: &Path, server_type: &str) -> Result<(), AppError> {
    ensure_dir(&path.join("resourcepacks"))?;
    ensure_dir(&path.join("shaderpacks"))?;
    ensure_dir(&path.join("datapacks"))?;
    ensure_dir(&path.join("modpacks"))?;
    ensure_dir(&path.join("logs"))?;
    match server_type {
        "fabric" | "forge" | "neoforge" => ensure_dir(&path.join("mods"))?,
        "paper" | "spigot" | "bukkit" => ensure_dir(&path.join("plugins"))?,
        "bedrock" => {
            ensure_dir(&path.join("worlds"))?;
            ensure_dir(&path.join("resource_packs"))?;
            ensure_dir(&path.join("behavior_packs"))?;
        }
        _ => {}
    }
    Ok(())
}

fn sanitize_file_name(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if matches!(character, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn resolve_server_path(server_id: &str, relative_path: &str) -> Result<PathBuf, CommandError> {
    let root = server_dir(server_id);
    let requested = Path::new(relative_path);
    if requested
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir | std::path::Component::Prefix(_) | std::path::Component::RootDir))
    {
        return Err(CommandError::from(AppError::InvalidInput(
            "Ungültiger Server-Pfad.".to_string(),
        )));
    }
    Ok(root.join(requested))
}

fn default_server_kind() -> String {
    "plugins".to_string()
}

fn default_true() -> bool {
    true
}

#[cfg(target_os = "windows")]
fn minecraft_bedrock_package_dir() -> Option<PathBuf> {
    minecraft_package_dir("Microsoft.MinecraftUWP_8wekyb3d8bbwe", "microsoft.minecraftuwp_")
}

#[cfg(target_os = "windows")]
fn minecraft_bedrock_preview_package_dir() -> Option<PathBuf> {
    minecraft_package_dir(
        "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe",
        "microsoft.minecraftwindowsbeta_",
    )
}

#[cfg(target_os = "windows")]
fn minecraft_package_dir(direct_name: &str, package_prefix: &str) -> Option<PathBuf> {
    let packages = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Packages");
    let direct = packages.join(direct_name);
    if direct.exists() {
        return Some(direct);
    }

    fs::read_dir(packages)
        .ok()?
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with(package_prefix)
        })
        .map(|entry| entry.path())
}

#[cfg(target_os = "windows")]
fn launch_windows_store_app(app_id: &str) -> Result<(), CommandError> {
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{app_id}"))
        .spawn()
        .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn minecraft_bedrock_package_dir() -> Option<PathBuf> {
    None
}

#[cfg(not(target_os = "windows"))]
fn minecraft_bedrock_preview_package_dir() -> Option<PathBuf> {
    None
}

fn kind_for_loader(server_type: &str) -> &'static str {
    match server_type {
        "fabric" | "forge" | "neoforge" => "modpack",
        "vanilla" => "vanilla",
        "bedrock" => "bedrock",
        _ => "plugins",
    }
}

fn loader_version_server_type(server_type: &str) -> bool {
    matches!(server_type, "fabric" | "forge" | "neoforge")
}

fn plugin_server_type(server_type: &str) -> bool {
    matches!(server_type, "paper" | "spigot" | "bukkit")
}

fn catalog_loader_facets(kind: &str, loader: &str) -> Vec<String> {
    if loader == "bedrock" {
        return Vec::new();
    }
    if kind == "plugin" && plugin_server_type(loader) {
        return vec!["paper".to_string(), "spigot".to_string(), "bukkit".to_string()];
    }
    vec![loader.to_string()]
}

fn modrinth_loaders_for_server(server_type: &str, kind: &str) -> Vec<String> {
    if server_type == "bedrock" {
        return Vec::new();
    }
    if matches!(kind, "resourcepack" | "shaderpack" | "datapack") {
        return Vec::new();
    }
    if kind == "plugin" && plugin_server_type(server_type) {
        return vec!["paper".to_string(), "spigot".to_string(), "bukkit".to_string()];
    }
    if matches!(server_type, "fabric" | "forge" | "neoforge") {
        return vec![server_type.to_string()];
    }
    vec![server_type.to_string()]
}

fn is_running(server_id: &str) -> bool {
    RUNNING_SERVERS
        .lock()
        .map(|servers| servers.contains_key(server_id))
        .unwrap_or(false)
}

fn ensure_dir(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path).map_err(AppError::from)
}

fn read_server_metadata(server_id: &str) -> Result<LocalServer, CommandError> {
    serde_json::from_str(&fs::read_to_string(server_dir(server_id).join("server-app.json")).map_err(AppError::from)?)
        .map_err(AppError::from)
        .map_err(CommandError::from)
}

fn write_server_metadata(server: &LocalServer) -> Result<(), AppError> {
    fs::write(
        server_dir(&server.id).join("server-app.json"),
        serde_json::to_string_pretty(server)?,
    )
    .map_err(AppError::from)
}

fn write_codex_metadata(server: &LocalServer) -> Result<(), AppError> {
    let path = server_dir(&server.id).join("codex-mcp.json");
    if !server.codex_enabled {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }

    let body = serde_json::json!({
        "serverId": server.id,
        "name": server.name,
        "enabled": true,
        "mcpPort": server.codex_mcp_port,
        "root": server_dir(&server.id),
        "tools": [
            "read_server_file",
            "write_server_file",
            "send_console_command",
            "install_plugin_or_mod",
            "install_resourcepack",
            "read_logs"
        ]
    });
    fs::write(path, serde_json::to_string_pretty(&body)?)?;
    Ok(())
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), AppError> {
    ensure_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn copy_dir_contents_for_backup(source: &Path, target: &Path) -> Result<(), AppError> {
    ensure_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_name = entry.file_name();
        if file_name.to_string_lossy().eq_ignore_ascii_case("backups") {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(&file_name);
        if entry.file_type()?.is_dir() {
            copy_dir_contents_for_backup(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn read_properties_map(path: &Path) -> Result<BTreeMap<String, String>, AppError> {
    let mut properties = BTreeMap::new();
    if !path.exists() {
        return Ok(properties);
    }

    for line in fs::read_to_string(path)?.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            properties.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    Ok(properties)
}

fn write_properties_map(path: &Path, properties: &BTreeMap<String, String>) -> Result<(), AppError> {
    let body = properties
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(path, format!("{body}\n")).map_err(AppError::from)
}

fn sync_server_from_properties(server: &mut LocalServer, properties: &BTreeMap<String, String>) {
    if let Some(port) = properties.get("server-port").and_then(|value| value.parse::<u16>().ok()) {
        server.port = port;
    }
    server.server_ip = properties
        .get("server-ip")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let name_key = if server.server_type == "bedrock" { "server-name" } else { "motd" };
    if let Some(motd) = properties.get(name_key).filter(|value| !value.trim().is_empty()) {
        server.name = motd.trim().to_string();
    }
}

fn write_server_properties(server: &LocalServer) -> Result<(), AppError> {
    let path = server_dir(&server.id).join("server.properties");
    let mut properties = read_properties_map(&path)?;
    if server.server_type == "bedrock" {
        properties.insert("server-name".to_string(), server.name.clone());
        properties.insert("server-port".to_string(), server.port.to_string());
        properties
            .entry("server-portv6".to_string())
            .or_insert_with(|| server.port.saturating_add(1).to_string());
        properties.entry("gamemode".to_string()).or_insert_with(|| "survival".to_string());
        properties.entry("difficulty".to_string()).or_insert_with(|| "easy".to_string());
        properties.entry("max-players".to_string()).or_insert_with(|| "10".to_string());
        properties.entry("online-mode".to_string()).or_insert_with(|| "true".to_string());
        properties.entry("allow-cheats".to_string()).or_insert_with(|| "false".to_string());
        return write_properties_map(&path, &properties);
    }

    properties.insert("server-ip".to_string(), server.server_ip.as_deref().unwrap_or("").to_string());
    properties.insert("server-port".to_string(), server.port.to_string());
    properties.insert("motd".to_string(), server.name.clone());
    properties.entry("enable-command-block".to_string()).or_insert_with(|| "true".to_string());
    properties.entry("online-mode".to_string()).or_insert_with(|| "true".to_string());
    properties.entry("pvp".to_string()).or_insert_with(|| "true".to_string());
    properties.entry("max-players".to_string()).or_insert_with(|| "20".to_string());
    properties.entry("difficulty".to_string()).or_insert_with(|| "easy".to_string());
    properties.entry("gamemode".to_string()).or_insert_with(|| "survival".to_string());
    write_properties_map(&path, &properties)
}

fn server_start_command(server: &LocalServer) -> Result<Command, CommandError> {
    let root = server_dir(&server.id);
    if server.server_type == "bedrock" {
        #[cfg(target_os = "windows")]
        let executable = root.join("bedrock_server.exe");
        #[cfg(not(target_os = "windows"))]
        let executable = root.join("bedrock_server");

        if !executable.exists() {
            return Err(CommandError::from(AppError::NotFound(
                "Bedrock Server-Datei fehlt. Erstelle oder aktualisiere den Server erneut.".to_string(),
            )));
        }

        let mut command = Command::new(executable);
        command.current_dir(root);
        return Ok(command);
    }

    let java = server.java_path.clone().unwrap_or_else(|| "java".to_string());
    let launch_args = server_launch_args(server)?;
    let mut command = Command::new(java);
    command.args(launch_args).current_dir(root);
    Ok(command)
}

fn server_launch_args(server: &LocalServer) -> Result<Vec<String>, CommandError> {
    let mut args = vec![
        format!("-Xmx{}M", server.ram_mb),
        format!("-Xms{}M", server.ram_mb.min(512)),
    ];

    if matches!(server.server_type.as_str(), "forge" | "neoforge") {
        if server_dir(&server.id).join("user_jvm_args.txt").exists() {
            args.push("@user_jvm_args.txt".to_string());
        }
        let arg_file = modded_launch_arg_file(server)?;
        args.push(format!("@{}", arg_file.to_string_lossy().replace('\\', "/")));
        args.push("nogui".to_string());
        return Ok(args);
    }

    args.extend(["-jar".to_string(), "server.jar".to_string(), "nogui".to_string()]);
    Ok(args)
}

fn modded_launch_arg_file(server: &LocalServer) -> Result<PathBuf, CommandError> {
    let loader_version = server
        .loader_version
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("Loader-Version fehlt.".to_string()))?;
    let root = server_dir(&server.id);
    let base = match server.server_type.as_str() {
        "forge" => PathBuf::from("libraries/net/minecraftforge/forge").join(loader_version),
        "neoforge" => PathBuf::from("libraries/net/neoforged/neoforge").join(loader_version),
        _ => {
            return Err(CommandError::from(AppError::InvalidInput(
                "Kein Forge/NeoForge Server.".to_string(),
            )))
        }
    };
    let platform_file = if cfg!(target_os = "windows") {
        "win_args.txt"
    } else {
        "unix_args.txt"
    };
    let candidates = [base.join(platform_file), base.join("win_args.txt"), base.join("unix_args.txt")];
    for candidate in candidates {
        if root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }

    find_modded_arg_file(&root, platform_file).ok_or_else(|| {
        CommandError::from(AppError::NotFound(
            "Forge/NeoForge Startdatei wurde nicht gefunden. Installiere den Loader neu.".to_string(),
        ))
    })
}

fn find_modded_arg_file(root: &Path, preferred_file: &str) -> Option<PathBuf> {
    let libraries = root.join("libraries");
    if !libraries.exists() {
        return None;
    }
    let mut stack = vec![libraries];
    let mut fallback = None;
    while let Some(path) = stack.pop() {
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(entry_path);
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == preferred_file {
                return entry_path.strip_prefix(root).ok().map(PathBuf::from);
            }
            if fallback.is_none() && (file_name == "win_args.txt" || file_name == "unix_args.txt") {
                fallback = entry_path.strip_prefix(root).ok().map(PathBuf::from);
            }
        }
    }
    fallback
}

fn validate_create_input(input: &CreateLocalServerInput) -> Result<(), CommandError> {
    if input.name.trim().is_empty() {
        return Err(CommandError::from(AppError::InvalidInput("Servername fehlt.".to_string())));
    }
    if input.minecraft_version.trim().is_empty() {
        return Err(CommandError::from(AppError::InvalidInput("Minecraft-Version fehlt.".to_string())));
    }
    validate_server_type(&input.server_type)?;
    if input.ram_mb < 512 {
        return Err(CommandError::from(AppError::InvalidInput(
            "RAM muss mindestens 512 MB sein.".to_string(),
        )));
    }
    Ok(())
}

fn validate_server_type(server_type: &str) -> Result<(), CommandError> {
    if !matches!(server_type, "paper" | "spigot" | "bukkit" | "fabric" | "forge" | "neoforge" | "vanilla" | "bedrock") {
        return Err(CommandError::from(AppError::InvalidInput(
            "Server-Typ muss Paper, Spigot, Bukkit, Fabric, Forge, NeoForge, Vanilla oder Bedrock sein.".to_string(),
        )));
    }
    Ok(())
}

async fn download_paper_server(server: &LocalServer) -> Result<(), CommandError> {
    let client = reqwest::Client::new();
    let builds: Value = client
        .get(format!(
            "https://fill.papermc.io/v3/projects/paper/versions/{}/builds",
            server.minecraft_version
        ))
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;
    let builds = builds
        .as_array()
        .ok_or_else(|| AppError::Download("Paper API lieferte keine Builds.".to_string()))?;
    let selected = builds
        .iter()
        .find(|build| build["channel"].as_str() == Some("STABLE"))
        .or_else(|| builds.last())
        .ok_or_else(|| AppError::Download("Keine Paper-Version gefunden.".to_string()))?;
    let url = selected["downloads"]["server:default"]["url"]
        .as_str()
        .ok_or_else(|| AppError::Download("Paper Download-URL fehlt.".to_string()))?;
    download_to(url, &server_dir(&server.id).join("server.jar")).await
}

async fn download_fabric_server(server: &mut LocalServer) -> Result<(), CommandError> {
    let loader = match &server.loader_version {
        Some(value) => value.clone(),
        None => latest_fabric_loader().await?,
    };
    server.loader_version = Some(loader.clone());
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/1.0.3/server/jar",
        server.minecraft_version, loader
    );
    download_to(&url, &server_dir(&server.id).join("server.jar")).await
}

async fn install_forge_server(server: &mut LocalServer) -> Result<(), CommandError> {
    let loader = match &server.loader_version {
        Some(value) => value.clone(),
        None => latest_forge_loader(&server.minecraft_version).await?,
    };
    server.loader_version = Some(loader.clone());
    let url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
        loader, loader
    );
    let installer_path = server_dir(&server.id).join(format!("forge-{}-installer.jar", loader));
    download_to(&url, &installer_path).await?;
    run_server_installer(server, &installer_path).await
}

async fn install_neoforge_server(server: &mut LocalServer) -> Result<(), CommandError> {
    let loader = match &server.loader_version {
        Some(value) => value.clone(),
        None => latest_neoforge_loader(&server.minecraft_version).await?,
    };
    server.loader_version = Some(loader.clone());
    let url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        loader, loader
    );
    let installer_path = server_dir(&server.id).join(format!("neoforge-{}-installer.jar", loader));
    download_to(&url, &installer_path).await?;
    run_server_installer(server, &installer_path).await
}

async fn run_server_installer(server: &LocalServer, installer_path: &Path) -> Result<(), CommandError> {
    let java = server.java_path.clone().unwrap_or_else(|| "java".to_string());
    let mut command = Command::new(java);
    command
        .arg("-jar")
        .arg(installer_path)
        .arg("--installServer")
        .current_dir(server_dir(&server.id))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| AppError::ProcessSpawnFailed(error.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(CommandError::from(AppError::ProcessError(format!(
            "Installer fehlgeschlagen: {}{}",
            stdout,
            stderr
        ))));
    }

    Ok(())
}

async fn download_vanilla_server(server: &LocalServer) -> Result<(), CommandError> {
    let client = reqwest::Client::new();
    let manifest: Value = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    let version_url = manifest["versions"]
        .as_array()
        .and_then(|versions| {
            versions
                .iter()
                .find(|version| version["id"].as_str() == Some(server.minecraft_version.as_str()))
        })
        .and_then(|version| version["url"].as_str())
        .ok_or_else(|| AppError::Download("Keine Vanilla-Version gefunden.".to_string()))?;

    let version: Value = client
        .get(version_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    let download_url = version["downloads"]["server"]["url"]
        .as_str()
        .ok_or_else(|| AppError::Download("Vanilla Server-Download fehlt.".to_string()))?;

    download_to(download_url, &server_dir(&server.id).join("server.jar")).await
}

async fn download_bedrock_server(server: &mut LocalServer) -> Result<(), CommandError> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = server;
        return Err(CommandError::from(AppError::UnsupportedOS(
            "Bedrock Dedicated Server wird in diesem Launcher aktuell nur auf Windows eingerichtet.".to_string(),
        )));
    }

    #[cfg(target_os = "windows")]
    {
        let client = reqwest::Client::new();
        let url = latest_bedrock_server_download_url(&client).await?;
        if let Some(version) = bedrock_version_from_download_url(&url) {
            server.minecraft_version = version;
        }

        let root = server_dir(&server.id);
        let zip_path = root.join("bedrock-server.zip");
        download_to(&url, &zip_path).await?;
        extract_zip_archive(&zip_path, &root)?;
        let _ = fs::remove_file(&zip_path);
        write_server_properties(server)?;
        Ok(())
    }
}

async fn latest_fabric_loader() -> Result<String, CommandError> {
    let versions: Value = reqwest::Client::new()
        .get("https://meta.fabricmc.net/v2/versions/loader")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;
    versions
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["stable"].as_bool().unwrap_or(false))
                .or_else(|| items.first())
        })
        .and_then(|item| item["version"].as_str())
        .map(ToString::to_string)
        .ok_or_else(|| CommandError::from(AppError::Download("Keine Fabric Loader-Version gefunden.".to_string())))
}

async fn latest_forge_loader(minecraft_version: &str) -> Result<String, CommandError> {
    let metadata = ForgeApi::new()
        .get_all_versions()
        .await
        .map_err(CommandError::from)?;
    metadata
        .get_latest_version_for_minecraft(minecraft_version)
        .ok_or_else(|| CommandError::from(AppError::Download("Keine Forge-Version gefunden.".to_string())))
}

async fn latest_neoforge_loader(minecraft_version: &str) -> Result<String, CommandError> {
    let metadata = NeoForgeApi::new()
        .get_all_versions()
        .await
        .map_err(CommandError::from)?;
    metadata
        .get_latest_version_for_minecraft(minecraft_version)
        .ok_or_else(|| CommandError::from(AppError::Download("Keine NeoForge-Version gefunden.".to_string())))
}

async fn download_to(url: &str, target: &Path) -> Result<(), CommandError> {
    let bytes = reqwest::Client::new()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .bytes()
        .await
        .map_err(AppError::from)?;
    fs::write(target, bytes).map_err(AppError::from).map_err(CommandError::from)
}

async fn latest_bedrock_server_download_url(client: &reqwest::Client) -> Result<String, CommandError> {
    let payload: Value = client
        .get("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .json()
        .await
        .map_err(AppError::from)?;

    if let Some(url) = payload["result"]["links"]
        .as_array()
        .and_then(|links| {
            links
                .iter()
                .find(|link| link["downloadType"].as_str() == Some("serverBedrockWindows"))
        })
        .and_then(|link| link["downloadUrl"].as_str())
        .filter(|url| url.contains("bedrock-server-") && url.ends_with(".zip"))
    {
        return Ok(url.to_string());
    }

    let page = client
        .get("https://www.minecraft.net/en-us/download/server/bedrock")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(AppError::from)?
        .error_for_status()
        .map_err(AppError::from)?
        .text()
        .await
        .map_err(AppError::from)?;
    find_bedrock_server_download_url(&page)
}

fn find_bedrock_server_download_url(page: &str) -> Result<String, CommandError> {
    let needle = "https://www.minecraft.net/bedrockdedicatedserver/bin-win/";
    let mut cursor = 0;
    while let Some(relative_start) = page[cursor..].find(needle) {
        let start = cursor + relative_start;
        let Some(relative_end) = page[start..].find(".zip") else {
            break;
        };
        let end = start + relative_end + 4;
        let candidate = page[start..end]
            .replace("\\/", "/")
            .replace("&amp;", "&");
        if candidate.contains("bedrock-server-") {
            return Ok(candidate);
        }
        cursor = end;
    }

    Err(CommandError::from(AppError::Download(
        "Bedrock Dedicated Server Download-URL wurde auf minecraft.net nicht gefunden.".to_string(),
    )))
}

fn bedrock_version_from_download_url(url: &str) -> Option<String> {
    url.split("bedrock-server-")
        .nth(1)
        .and_then(|tail| tail.split(".zip").next())
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn extract_zip_archive(zip_path: &Path, target: &Path) -> Result<(), CommandError> {
    let file = fs::File::open(zip_path).map_err(AppError::from)?;
    let mut archive = zip::ZipArchive::new(file).map_err(AppError::from)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(AppError::from)?;
        let Some(enclosed_name) = entry.enclosed_name() else {
            return Err(CommandError::from(AppError::ArchiveReadError(
                "ZIP enthÃ¤lt einen ungÃ¼ltigen Pfad.".to_string(),
            )));
        };
        let outpath = target.join(enclosed_name);

        if entry.is_dir() {
            ensure_dir(&outpath)?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            ensure_dir(parent)?;
        }
        let mut outfile = fs::File::create(&outpath).map_err(AppError::from)?;
        std::io::copy(&mut entry, &mut outfile).map_err(AppError::from)?;
    }

    Ok(())
}

fn pipe_process_output<R>(app: AppHandle, server_id: String, stream: &'static str, reader: R)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().flatten() {
            let _ = app.emit(
                "nrc_server_log",
                LogPayload {
                    server_id: server_id.clone(),
                    stream: stream.to_string(),
                    line,
                },
            );
        }
    });
}
