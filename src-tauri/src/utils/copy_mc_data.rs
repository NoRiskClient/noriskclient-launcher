use std::path::PathBuf;

use async_walkdir::{Filtering, WalkDir};
use futures::StreamExt;
use tauri::Manager;
use tokio::fs;
use tracing::error;

use crate::app::gui::get_options;

pub struct McDataHandler {}

impl McDataHandler {
    pub async fn copy_mc_data(path: &str, branch: &str, app: tauri::AppHandle) -> Result<(), String> {
        let options = get_options().await.map_err(|e| format!("unable to load options: {:?}", e))?;
        let mc_folder_path = PathBuf::from(path);
    
        if !mc_folder_path.exists() {
            return Err("Minecraft folder does not exist".to_string());
        }
    
        let branch_dir_path = options.data_path_buf().join("gameDir").join(branch);
    
        if !&branch_dir_path.exists() {
            fs::create_dir_all(&branch_dir_path).await.map_err(|e| format!("unable to create branch directory: {:?}", e))?;
        }
    
        let servers_path = mc_folder_path.join("servers.dat");
        let new_servers_path = &branch_dir_path.join("servers.dat");
    
        if servers_path.exists() {
            fs::copy(&servers_path, &new_servers_path).await.map_err(|e| format!("unable to copy servers.dat: {:?}", e))?;
        }
    
        let options_path = mc_folder_path.join("options.txt");
        let new_options_path = &branch_dir_path.join("options.txt");
    
        if options_path.exists() {
            fs::copy(&options_path, &new_options_path).await.map_err(|e| format!("unable to copy options.txt: {:?}", e))?;
        }
    
        let resource_packs_path = mc_folder_path.join("resourcepacks");
        let new_resource_packs_path = &branch_dir_path.join("resourcepacks");
    
        if resource_packs_path.exists() {
            Self::copy_mc_dir_all(&resource_packs_path, &new_resource_packs_path, &app).await.map_err(|e| format!("unable to copy resource packs: {:?}", e))?;
        }
    
        let shader_packs_path = mc_folder_path.join("shaderpacks");
        let new_shader_packs_path = &branch_dir_path.join("shaderpacks");
    
        if shader_packs_path.exists() {
            Self::copy_mc_dir_all(&shader_packs_path, &new_shader_packs_path, &app).await.map_err(|e| format!("unable to copy shader packs: {:?}", e))?;
        }
    
        let saves_path = mc_folder_path.join("saves");
        let new_saves_path = &branch_dir_path.join("saves");
    
        if saves_path.exists() {
            Self::copy_mc_dir_all(&saves_path, &new_saves_path, &app).await.map_err(|e| format!("unable to copy saves: {:?}", e))?;
        }
            
        Ok(())
    }
    
    pub async fn copy_branch_data(old_branch: &str, new_branch: &str, app: tauri::AppHandle) -> Result<(), String> {
        let options = get_options().await.map_err(|e| format!("unable to load options: {:?}", e))?;
        let old_branch_path = options.data_path_buf().join("gameDir").join(old_branch);
        let new_branch_path = options.data_path_buf().join("gameDir").join(new_branch);
    
        if !old_branch_path.exists() {
            error!("Old branch directory does not exist: {:?}", old_branch_path);
        } else if !new_branch_path.exists() {
            fs::create_dir_all(&new_branch_path).await.map_err(|e| format!("unable to create new branch directory: {:?}", e))?;
        }
    
        let old_servers_path = old_branch_path.join("servers.dat");
        let new_servers_path = new_branch_path.join("servers.dat");
    
        if old_servers_path.exists() {
            fs::copy(&old_servers_path, &new_servers_path).await.map_err(|e| format!("unable to copy servers.dat: {:?}", e))?;
        }
    
        let old_options_path = old_branch_path.join("options.txt");
        let new_options_path = new_branch_path.join("options.txt");
    
        if old_options_path.exists() {
            fs::copy(&old_options_path, &new_options_path).await.map_err(|e| format!("unable to copy options.txt: {:?}", e))?;
        }
    
        let old_resource_packs_path = old_branch_path.join("resourcepacks");
        let new_resource_packs_path = new_branch_path.join("resourcepacks");
    
        if old_resource_packs_path.exists() {
            Self::copy_mc_dir_all(&old_resource_packs_path, &new_resource_packs_path, &app).await.map_err(|e| format!("unable to copy resource packs: {:?}", e))?;
        }
    
        let old_shader_packs_path = old_branch_path.join("shaderpacks");
        let new_shader_packs_path = new_branch_path.join("shaderpacks");
    
        if old_shader_packs_path.exists() {
            Self::copy_mc_dir_all(&old_shader_packs_path, &new_shader_packs_path, &app).await.map_err(|e| format!("unable to copy shader packs: {:?}", e))?;
        }
    
        let old_saves_path = old_branch_path.join("saves");
        let new_saves_path = new_branch_path.join("saves");
    
        if old_saves_path.exists() {
            Self::copy_mc_dir_all(&old_saves_path, &new_saves_path, &app).await.map_err(|e| format!("unable to copy saves: {:?}", e))?;
        }
    
        let old_nrc_data_path = old_branch_path.join("NoRiskClient");
        let new_nrc_data_path = new_branch_path.join("NoRiskClient");
    
        if old_nrc_data_path.exists() {
            Self::copy_mc_dir_all(&old_nrc_data_path, &new_nrc_data_path, &app).await.map_err(|e| format!("unable to copy NoRiskClient data: {:?}", e))?;
        }
    
        Ok(())
    }
    
    async fn copy_mc_dir_all(src: &PathBuf, dst: &PathBuf, app: &tauri::AppHandle) -> Result<(), String> {
        let src_clone = src.clone();
        let dst_clone = dst.clone();
        let app_clone = app.clone();
    
        tokio::spawn(Box::pin(async move {
            let mut entries = WalkDir::new(&src_clone);
    
            let mut current_type = String::new();
            let mut total_type_entry_count = 0;
            let mut current_type_entry_count = 0;
    
            loop {
                match entries.next().await {
                    Some(Ok(entry)) => {
                        let path = entry.path();
                        let relative_path = path.strip_prefix(&src_clone).unwrap();
                        let dst_path = &dst_clone.join(relative_path);
    
                        if entry.file_type().await.unwrap().is_dir() {
                            let _  = fs::create_dir(&dst_path).await;
                            if vec!["resourcepacks", "shaderpacks", "saves", "NoRiskClient"].contains(&entry.path().parent().unwrap().file_name().unwrap().to_str().unwrap()) && current_type != entry.clone().path().parent().unwrap().file_name().unwrap().to_str().unwrap().to_string() {
                                let children = WalkDir::new(&path.parent().unwrap());
                                current_type = entry.path().parent().unwrap().file_name().unwrap().to_str().unwrap().to_string();
                                total_type_entry_count = children.filter(|c| async move { if c.file_type().await.unwrap().is_file() { Filtering::Continue } else { Filtering::Ignore } }).count().await;
                                current_type_entry_count = 0;
                                let _ = &app_clone.get_window("main").unwrap().emit("copy-mc-data", CopyMcDataEventPayload { r#type: current_type.clone(), file: String::new(), total_type_entry_count: total_type_entry_count, current_type_entry_count: current_type_entry_count }).unwrap_or_default();
                            }
                        } else {
                            let _  = fs::create_dir_all(dst_path.parent().unwrap()).await;
                            let _  = fs::copy(path, dst_path).await;
                            current_type_entry_count += 1;
                            let _ = &app_clone.get_window("main").unwrap().emit("copy-mc-data", CopyMcDataEventPayload { r#type: current_type.clone(), file: entry.file_name().to_str().unwrap().to_string(), total_type_entry_count: total_type_entry_count, current_type_entry_count: current_type_entry_count }).unwrap_or_default();
                        }
                    },
                    Some(Err(e)) => {
                        error!("error: {}", e);
                        break;
                    }
                    None => break,
                }
            }
        })).await.map_err(|e| format!("Error copying directory: {:?}", e))?;
    
        Ok(())
    }
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct CopyMcDataEventPayload {
    r#type: String,
    file: String,
    total_type_entry_count: usize,
    current_type_entry_count: usize,
}