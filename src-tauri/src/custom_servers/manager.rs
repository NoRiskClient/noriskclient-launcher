use std::{path::PathBuf, sync::{Arc, Mutex}};

use anyhow::{Ok, Result};
use log::{debug, error, info};
use tauri::Window;
use tokio::{fs, process::Child};

use crate::{app::{api::ApiEndpoints, app_data::LauncherOptions, gui::get_options}, custom_servers::{models::{CustomServerEventPayload, CustomServerTokenResponse}, providers::forwarding_manager::ForwardingManagerProvider}, minecraft::{java::{find_java_binary, jre_downloader, JavaRuntime}, progress::ProgressUpdate}, LAUNCHER_DIRECTORY};
use crate::app::gui::minecraft_auth_get_default_user;

use super::{models::{CustomServer, CustomServerProgressEventPayload, CustomServerType, LatestRunningServer}, providers::{forge::ForgeProvider, vanilla::VanillaProvider}};


pub struct CustomServerManager {}

impl CustomServerManager {
    pub async fn initialize_server(window: &Arc<Mutex<Window>>, server: CustomServer, additional_data: Option<&str>) -> Result<()> {
        match server.r#type {
            CustomServerType::VANILLA => {
                let label = ProgressUpdate::SetLabel("Downloading server jar...".to_owned());
                let _ = Self::handle_progress(&window, &server.id, label);
                let _ = VanillaProvider::download_server_jar(&server, &additional_data.clone().unwrap_or_default()).await;
                let _ = Self::create_eula_file(&server).await;
            }
            CustomServerType::FORGE => {
                let label = ProgressUpdate::SetLabel("Downloading installer jar...".to_owned());
                let _ = Self::handle_progress(&window, &server.id, label);
                let _ = ForgeProvider::download_installer_jar(&server).await;
                let _ = Self::create_eula_file(&server).await;
            },
            CustomServerType::FABRIC => todo!(),
            CustomServerType::NEO_FORGE => todo!(),
            CustomServerType::QUILT => todo!(),
            CustomServerType::PAPER => todo!(),
            CustomServerType::SPIGOT => todo!(),
            CustomServerType::BUKKIT => todo!(),
            CustomServerType::FOLIA => todo!(),
            CustomServerType::PURPUR => todo!(),
        }
        Ok(())
    }

    async fn create_eula_file(custom_server: &CustomServer) -> Result<()> {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id);
        fs::create_dir_all(&path).await?;
        let content = "# USER HAS AGREED TO THIS THROUGH THE GUI OF THE NRC LAUNCHER!\neula=true";
        let _ = fs::write(path.join("eula.txt"), Vec::from(content)).await.map_err(|e| e);
        Ok(())
    }

    pub async fn run_server(custom_server: CustomServer, options: &LauncherOptions, token: String, window_mutex: Arc<Mutex<Window>>) -> Result<Child> {
        // JRE download
        let runtimes_folder = options.data_path_buf().join("runtimes");
        if !runtimes_folder.exists() {
            fs::create_dir(&runtimes_folder).await?;
        }

        let custom_java_path = if !options.custom_java_path.is_empty() { Some(options.custom_java_path.clone()) } else { None };

        let java_bin = match &custom_java_path {
            Some(path) => PathBuf::from(path),
            None => {
                info!("Checking for JRE...");
                let _ = Self::handle_progress(&window_mutex, &custom_server.id, ProgressUpdate::SetLabel("Checking for JRE...".to_owned()))?;

                match find_java_binary(&runtimes_folder, 21).await {
                    Result::Ok(jre) => jre, // Fix: Wrap the value in a tuple variant
                    Err(e) => {
                        error!("Failed to find JRE: {}", e);
                        
                        info!("Download JRE...");
                        let _ = Self::handle_progress(&window_mutex, &custom_server.id, ProgressUpdate::SetLabel("Download JRE...".to_owned()))?;
                        jre_downloader::jre_download(&runtimes_folder, 21, |a, b| {
                            let _ = Self::handle_progress(&window_mutex, &custom_server.id, ProgressUpdate::SetProgress((a / b) * 100));
                        }).await?
                    }
                }
            }
        };
        debug!("Java binary: {}", java_bin.to_str().unwrap());
        // Game
        let java_runtime = JavaRuntime::new(java_bin);

        let custom_server_path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id);

        Self::handle_property_file_defaults(&custom_server.id).await;

        ForwardingManagerProvider::maintain_forwarding_manager().await?;

        let mut running_task = java_runtime.run_server(2048, 2048, &custom_server_path).await?;

        Self::store_latest_running_server(None, running_task.id(), Some(custom_server.id.clone())).await?;

        let custom_server_clone = custom_server.clone();

        //Das sollte anders gelöst werden
        let todo_credentials = minecraft_auth_get_default_user().await?.unwrap();

        let tokens: CustomServerTokenResponse = ApiEndpoints::request_from_norisk_endpoint(&format!("launcher/custom-servers/{}/token", &custom_server.id), &token, &todo_credentials.id.to_string()).await.map_err(|err| format!("Failed to get token: {}", err)).unwrap();

        let _ = java_runtime.handle_server_io(&mut running_task, &custom_server_clone, &tokens, Self::handle_stdout, Self::handle_stderr, &java_runtime, &window_mutex).await.map_err(|e| format!("Failed to handle server IO: {}", e));

        Ok(running_task)
    }

    pub async fn read_and_process_server_log_file(window: &Arc<Mutex<Window>>, server_id: &str) -> Result<()> {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(server_id).join("logs").join("latest.log");
        let content = fs::read_to_string(&path).await.map_err(|e| format!("Failed to read log file: {}", e)).unwrap();
        let lines: Vec<String> = content.lines().collect::<Vec<&str>>().iter().map(|line| line.to_string()).collect();
        if lines.last().unwrap().contains("Thread RCON Listener stopped") {
            
            Self::store_latest_running_server(None, None, None).await?;
        } else {
            lines.iter().for_each(|line| {
                let _ = window.lock().unwrap().emit("custom-server-process-output", CustomServerEventPayload { server_id: server_id.to_owned(), data: line.to_owned() }).map_err(|e| format!("Failed to emit custom-server-process-output: {}", e)).unwrap();
            });
        }

        Ok(())
    }

    async fn handle_property_file_defaults(server_id: &str) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(server_id).join("server.properties");
        let mut properties: Vec<(String, String)> = if path.exists() {
            let content = fs::read_to_string(&path).await.unwrap();
            content.lines().map(|line| {
                if line.starts_with('#') {
                    (line.to_owned(), "".to_owned())
                } else {
                    let mut parts = line.split('=');
                    let key = parts.next().unwrap().to_owned();
                    let value = parts.next().unwrap().to_owned();
                    (key, value)
                }
            }).collect()
        } else {
            Vec::new()
        };

        let mut force_defauls: Vec<(String, String)> = Vec::new();
        force_defauls.push(("enable-rcon".to_owned(), "true".to_owned()));
        force_defauls.push(("rcon.port".to_owned(), "25594".to_owned()));
        force_defauls.push(("rcon.password".to_owned(), "minecraft".to_owned()));
        force_defauls.push(("max-players".to_owned(), "10".to_owned())); // TODO: Add slider support
        force_defauls.push(("broadcast-rcon-to-ops".to_owned(), "false".to_owned()));
        if properties.is_empty() {
            force_defauls.push(("white-list".to_owned(), "true".to_owned()));
            force_defauls.push(("motd".to_owned(), "Hosted using norisk.gg!".to_owned()));
        }


        for (key, value) in force_defauls {
            if properties.iter().find(|(k, _)| k == &key).is_none() {
                properties.push((key, value));
            } else {
                // replace the value without pushing a new set to the vector
                let index = properties.iter().position(|(k, _)| k == &key).unwrap();
                properties[index] = (key, value);
            }
        }

        let content = properties.iter().map(|(key, value)| format!("{}{}{}", key, if key.starts_with("#") { "" } else { "=" }, value)).collect::<Vec<String>>().join("\n");
        fs::write(&path, content).await.unwrap();
    }

    fn handle_stdout(window: &Arc<Mutex<Window>>, server_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let data = String::from_utf8(data.to_vec())?;
        if data.is_empty() || data.to_string().contains("RCON Client /127.0.0.1") {
            return Ok(()); // ignore empty lines
        }
    
        info!("{}", data.trim());
        window.lock().unwrap().emit("custom-server-process-output", CustomServerEventPayload { server_id: server_id.to_owned(), data: data })?;
        Ok(())
    }
    
    fn handle_stderr(window: &Arc<Mutex<Window>>, server_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let data = String::from_utf8(data.to_vec())?;
        if data.is_empty() {
            return Ok(()); // ignore empty lines
        }
    
        error!("{}", data.trim());
        window.lock().unwrap().emit("custom-server-process-output", CustomServerEventPayload { server_id: server_id.to_owned(), data: data })?;
        Ok(())
    }
    
    fn handle_progress(window: &Arc<std::sync::Mutex<Window>>, server_id: &str, progress_update: ProgressUpdate) -> anyhow::Result<()> {
        window.lock().unwrap().emit("custom-server-progress-update", CustomServerProgressEventPayload { server_id: server_id.to_owned(), data: progress_update })?;
        Ok(())
    }

    pub async fn load_latest_running_server() -> Result<LatestRunningServer> {
        // load the options from the file
        let path = get_options().await.unwrap().data_path_buf().join("custom_servers");
        if !path.exists() {
            fs::create_dir_all(&path).await?;
        }
        let latest_running_server = serde_json::from_slice::<LatestRunningServer>(&fs::read(path.join("latest.json")).await?).map_err(|err| -> String { format!("Failed to write latest.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LatestRunningServer::default());
        Ok(latest_running_server)
    }

    pub async fn store_latest_running_server(forwarder_process_id: Option<u32>, process_id: Option<u32>, server_id: Option<String>) -> Result<()> {
        let path = get_options().await.unwrap().data_path_buf().join("custom_servers");
        if !path.exists() {
            fs::create_dir_all(&path).await?;
        }
        let latest_running_server = LatestRunningServer {
            forwarder_process_id,
            process_id,
            server_id,
        };
        let _ = fs::write(path.join("latest.json"), serde_json::to_string_pretty(&latest_running_server)?).await.map_err(|err| -> String { format!("Failed to write options.json: {}", err).into() });
        Ok(())
    }
}