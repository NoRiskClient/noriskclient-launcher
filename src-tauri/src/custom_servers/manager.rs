use std::{path::PathBuf, sync::{Arc, Mutex}};

use anyhow::{Ok, Result};
use log::{debug, error, info};
use tauri::Window;
use tokio::{fs, process::Child};

use crate::{app::{api::ApiEndpoints, app_data::LauncherOptions}, custom_servers::forwarding_manager::GetTokenResponse, minecraft::{java::{find_java_binary, jre_downloader, JavaRuntime}, progress::ProgressUpdate}, LAUNCHER_DIRECTORY};
use crate::app::gui::minecraft_auth_get_default_user;

use super::{models::{CustomServer, CustomServerType}, providers::{forge::ForgeProvider, vanilla::VanillaProvider}};


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

    pub async fn run_server(custom_server: CustomServer, options: LauncherOptions, token: String, window_mutex: Arc<Mutex<Window>>) -> Result<Child> {
        // JRE download
        let runtimes_folder = options.data_path_buf().join("runtimes");
        if !runtimes_folder.exists() {
            fs::create_dir(&runtimes_folder).await?;
        }

        let custom_java_path = if !options.custom_java_path.is_empty() { Some(options.custom_java_path) } else { None };

        let java_bin = match &custom_java_path {
            Some(path) => PathBuf::from(path),
            None => {
                info!("Checking for JRE...");
                let _ = Self::handle_progress(&window_mutex, &custom_server.id, ProgressUpdate::SetLabel("Checking for JRE...".to_owned()))?;
                
                match find_java_binary(&runtimes_folder, 17).await {
                    Result::Ok(jre) => jre, // Fix: Wrap the value in a tuple variant
                    Err(e) => {
                        error!("Failed to find JRE: {}", e);
                        
                        info!("Download JRE...");
                        let _ = Self::handle_progress(&window_mutex, &custom_server.id, ProgressUpdate::SetLabel("Download JRE...".to_owned()))?;
                        jre_downloader::jre_download(&runtimes_folder, 17, |a, b| {
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

        let mut running_task = java_runtime.run_server(2048, 2048, &custom_server_path).await?;

        let custom_server_clone = custom_server.clone();

        //Das sollte anders gelöst werden
        let todo_credentials = minecraft_auth_get_default_user().await?.unwrap();

        let tokens: GetTokenResponse = ApiEndpoints::request_from_norisk_endpoint(&format!("launcher/custom-servers/{}/token", &custom_server.id), &token, &todo_credentials.id.to_string()).await.map_err(|err| format!("Failed to get token: {}", err)).unwrap();

        java_runtime.handle_server_io(&mut running_task, &custom_server_clone, &tokens, Self::handle_stdout, Self::handle_stderr, &window_mutex).await.map_err(|e| format!("Failed to handle server IO: {}", e));

        Ok(running_task)
    }

    fn handle_stdout(window: &Arc<Mutex<Window>>, server_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let data = String::from_utf8(data.to_vec())?;
        if data.is_empty() {
            return Ok(()); // ignore empty lines
        }
    
        info!("{}", data);
        window.lock().unwrap().emit("custom-server-process-output", CustomServerEventPayload { server_id: server_id.to_owned(), data: data })?;
        Ok(())
    }
    
    fn handle_stderr(window: &Arc<Mutex<Window>>, server_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let data = String::from_utf8(data.to_vec())?;
        if data.is_empty() {
            return Ok(()); // ignore empty lines
        }
    
        error!("{}", data);
        window.lock().unwrap().emit("custom-server-process-output", CustomServerEventPayload { server_id: server_id.to_owned(), data: data })?;
        Ok(())
    }
    
    fn handle_progress(window: &Arc<std::sync::Mutex<Window>>, server_id: &str, progress_update: ProgressUpdate) -> anyhow::Result<()> {
        window.lock().unwrap().emit("custom-server-progress-update", CustomServerProgressEventPayload { server_id: server_id.to_owned(), data: progress_update })?;
        Ok(())
    }
}

#[derive(serde::Serialize, Clone, Debug)]
struct CustomServerEventPayload {
    server_id: String,
    data: String
}

#[derive(serde::Serialize, Clone, Debug)]
struct CustomServerProgressEventPayload {
    server_id: String,
    data: ProgressUpdate
}