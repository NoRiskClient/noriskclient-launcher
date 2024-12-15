use std::error::Error;
use std::fs::File;
#[cfg(target_os = "linux")]
use std::fs::metadata;
use std::io::Read;
use std::path::PathBuf;
use std::process::Command;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use log::debug;

use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::app::api::get_api_base;
use crate::app::app_data::LauncherOptions;

/// Placeholder struct for API endpoints implementation
pub struct CapeApiEndpoints;

impl CapeApiEndpoints {
    pub async fn equip_cape(token: &str, uuid: &str, hash: &str) -> Result<(), String> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();

        // Baue die URL mit dem Token als Query-Parameter
        let url = format!("{}/cosmetics/cape/{}/equip?uuid={}", get_api_base(options.experimental_mode), hash, uuid);

        // Sende den POST-Request
        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|err| format!("Fehler beim Senden des Requests: {}", err))?;

        debug!("Cape equiped status {:?}",response.status());

        return match response.status() {
            StatusCode::OK => Ok(()),
            _ => {
                let response_text = response.text().await.map_err(|err| {
                    format!("Error reading the request: {}", err)
                })?;
                Err(response_text)
            }
        };
    }

    pub async fn delete_cape(token: &str, uuid: &str, hash: &str) -> Result<(), String> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();

        // Baue die URL mit dem Token als Query-Parameter
        let url = format!("{}/cosmetics/cape/{}?uuid={}", get_api_base(options.experimental_mode), hash, uuid);

        // Sende den POST-Request
        let response = HTTP_CLIENT
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|err| format!("Fehler beim Senden des Requests: {}", err))?;

        debug!("Cape delete status {:?}",response.status());

        return match response.status() {
            StatusCode::OK => Ok(()),
            _ => {
                let response_text = response.text().await.map_err(|err| {
                    format!("Error reading the request: {}", err)
                })?;
                Err(response_text)
            }
        };
    }

    pub async fn upload_cape(token: &str, uuid: &str, image_path: PathBuf) -> Result<String, String> {
        debug!("Image Path {:?}",image_path);
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        // Lese den Inhalt der Bilddatei in Bytes ein
        match File::open(image_path) {
            Ok(mut file) => {
                let mut image_data = Vec::new();
                file.read_to_end(&mut image_data).expect("Error Reading File");

                // Baue die URL mit dem Token als Query-Parameter
                let url = format!("{}/cosmetics/cape?uuid={}", get_api_base(options.experimental_mode), uuid);

                // Sende den POST-Request
                let response = HTTP_CLIENT
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", token))
                    .body(image_data)
                    .send()
                    .await
                    .map_err(|err| format!("Fehler beim Senden des Requests: {}", err))?;

                debug!("Cape upload status {:?}",response.status());

                let response_text = response.text().await.map_err(|err| {
                    format!("Error reading cape upload response text: {}", err)
                })?;
                Ok(response_text)
            }
            Err(_err) => {
                Err("Error Selecting Cape".parse().unwrap())
            }
        }
    }

    pub async fn mc_name_by_uuid(uuid: &str) -> Result<String, Box<dyn Error>> {
        debug!("Requesting Minecraft Username {}",uuid);
        let url = format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", uuid);
        let response = HTTP_CLIENT.get(url).send().await?;
        let response_text = response.json::<McProfile>().await?;
        Ok(response_text.name)
    }

    pub async fn mc_uuid_by_name(username: &str) -> Result<String, Box<dyn Error>> {
        debug!("Requesting Minecraft UUID {}",username);
        let url = format!("https://api.mojang.com/users/profiles/minecraft/{}", username);
        let response = HTTP_CLIENT.get(url).send().await?;
        let response_text = response.json::<McProfile>().await?;
        let uuid = uuid::Uuid::parse_str(&response_text.id)?;
        Ok(uuid.to_string())
    }

    pub async fn cape_hash_by_uuid(uuid: &str) -> Result<String, Box<dyn Error>> {
        debug!("Requesting Cape Hash {}",uuid);
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/cosmetics/user/{}/cape", get_api_base(options.experimental_mode), uuid);
        let response = HTTP_CLIENT.get(url).send().await?;
        let response_text = response.text().await?;
        Ok(response_text)
    }

    pub async fn unequip_cape(norisk_token: &str, uuid: &str) -> Result<(), String> {
        // Baue die URL mit dem Token als Query-Parameter
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/cosmetics/cape/unequip?uuid={}", get_api_base(options.experimental_mode), uuid);

        // Sende den POST-Request
        let response = HTTP_CLIENT
            .delete(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|err| format!("Error while sending the request: {}", err))?;

        debug!("Unequip cape status {:?}",response.status());

        return match response.status() {
            StatusCode::OK => {
                Ok(())
            }
            _ => {
                let response_text = response.text().await.map_err(|err| {
                    format!("Error reading the request: {}", err)
                })?;
                Err(response_text)
            }
        };
    }

    pub async fn request_trending_capes(norisk_token: &str, uuid: &str, alltime: u32, limit: u32) -> Result<Vec<Cape>, Box<dyn Error>> {
        debug!("Requesting Trending Capes...");
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/cosmetics/cape/trending?uuid={}&alltime={}&limit={}", get_api_base(options.experimental_mode), uuid, alltime, limit);
        Ok(HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<Vec<Cape>>().await?)
    }

    pub async fn request_user_capes(norisk_token: &str, uuid: &str, username: &str) -> Result<Vec<Cape>, Box<dyn Error>> {
        debug!("Requesting User Capes of {}...", username);
        let target_uuid = Self::mc_uuid_by_name(username).await?;
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/cosmetics/cape/user/{}?uuid={}", get_api_base(options.experimental_mode), target_uuid, uuid);
        Ok(HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<Vec<Cape>>().await?)
    }

    pub async fn request_owned_capes(norisk_token: &str, uuid: &str) -> Result<Vec<Cape>, Box<dyn Error>> {
        debug!("Requesting Owned Capes...");
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/cosmetics/cape/owned?uuid={}&limit=250", get_api_base(options.experimental_mode), uuid);
        Ok(HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<Vec<Cape>>().await?)
    }

    pub fn show_in_folder(path: &str) {
        debug!("Spawning Path {}",path);
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .args(["/select,", &path]) // The comma after select is not a typo
                .spawn()
                .unwrap();
        }

        /* TODO Später
        #[cfg(target_os = "linux")]
        {
            if path.contains(",") {
                // see https://gitlab.freedesktop.org/dbus/dbus/-/issues/76
                let new_path = match metadata(&path).unwrap().is_dir() {
                    true => path,
                    false => {
                        let mut path2 = PathBuf::from(path);
                        path2.pop();
                        &path2.into_os_string().into_string().unwrap()
                    }
                };
                Command::new("xdg-open")
                    .arg(&new_path)
                    .spawn()
                    .unwrap();
            } else {
                if let Ok(Fork::Child) = daemon(false, false) {
                    Command::new("dbus-send")
                        .args(["--session", "--dest=org.freedesktop.FileManager1", "--type=method_call",
                            "/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
                            format!("array:string:\"file://{path}\"").as_str(), "string:\"\""])
                        .spawn()
                        .unwrap();
                }
            }
        }
        */

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .args(["-R", &path])
                .spawn()
                .unwrap();
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McProfile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Cape {
    #[serde(rename = "_id")]
    pub hash: String,
    pub accepted: bool,
    pub uses: u32,
    #[serde(rename = "firstSeen")]
    pub first_seen: String,
    #[serde(rename = "creationDate")]
    pub creation_date: i64,
}
