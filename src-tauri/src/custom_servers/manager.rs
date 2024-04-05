use std::sync::{Arc, Mutex};

use anyhow::Result;
use tauri::Window;
use tokio::fs;
use tracing::{error, info};

use crate::{minecraft::progress::ProgressUpdate, LAUNCHER_DIRECTORY};

use super::{models::{CustomServer, CustomServerType}, providers::{forge::ForgeProvider, vanilla::VanillaProvider}};


pub struct CustomServerManager {}

impl CustomServerManager {
    pub async fn initialize_server(window: &Arc<Mutex<Window>>, server: CustomServer, additional_data: Option<&str>) -> Result<()> {
        match server.r#type {
            CustomServerType::VANILLA => {
                let label = ProgressUpdate::SetLabel("Downloading server jar...".to_owned());
                let _ = Self::handle_progress(&window, &server.id, label);
                let _ = VanillaProvider::download_server_jar(&server, &additional_data.clone().unwrap_or_default(), |curr, max| {
                    let max_progress = ProgressUpdate::SetMax(max);
                    let progress = ProgressUpdate::SetProgress((curr / max) * 100);
                    let _ = Self::handle_progress(&window, &server.id, max_progress).unwrap();
                    let _ = Self::handle_progress(&window, &server.id, progress).unwrap();
                }).await;
                let _ = Self::create_eula_file(&server).await;
            }
            CustomServerType::FORGE => {
                let label = ProgressUpdate::SetLabel("Downloading installer jar...".to_owned());
                let _ = Self::handle_progress(&window, &server.id, label);
                let _ = ForgeProvider::download_installer_jar(&server, |curr, max| {
                    let max_progress = ProgressUpdate::SetMax(max);
                    let progress = ProgressUpdate::SetProgress((curr / max) * 100);
                    let _ = Self::handle_progress(&window, &server.id, max_progress).unwrap();
                    let _ = Self::handle_progress(&window, &server.id, progress).unwrap();
                }).await;
                let _ = Self::create_eula_file(&server).await;
            },
            CustomServerType::FABRIC => todo!(),
            CustomServerType::NEO_FORGE => todo!(),
            CustomServerType::QUILT => todo!(),
            CustomServerType::PAPER => todo!(),
            CustomServerType::SPONGE => todo!(),
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

    async fn run_server() -> Result<()> {
        todo!()
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
    
    fn handle_stderr(window: &Arc<std::sync::Mutex<Window>>, server_id: &str, data: &[u8]) -> anyhow::Result<()> {
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