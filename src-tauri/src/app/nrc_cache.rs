use std::path::Path;
use std::sync::{Arc, Mutex};

use log::debug;
use log::error;
use serde::Deserialize;
use sysinfo::{Pid, ProcessExt, System, SystemExt};
use tauri::Manager;
use tokio::fs;
use uuid::Uuid;

use crate::app::api::{ApiEndpoints, NoRiskLaunchManifest};
use crate::app::app_data::LauncherOptions;
use crate::error::Error;
use crate::minecraft::minecraft_auth::Credentials;
use crate::minecraft::progress::ProgressUpdate;
use crate::LAUNCHER_DIRECTORY;

pub struct NRCCache {}

#[derive(serde::Serialize, Deserialize, Debug, Clone)] // Damit diese Struktur serialisierbar ist
pub struct OutputData {
    pub id: Uuid,
    pub text: String,
}

#[derive(serde::Serialize, Deserialize, Debug)] // Damit diese Struktur serialisierbar ist
pub struct RunnerInstance {
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    pub terminator: Option<tokio::sync::oneshot::Sender<()>>,
    pub id: Uuid,  // Speichert die ID direkt als Uuid
    #[serde(rename = "progressUpdates")]
    pub progress_updates: Vec<ProgressUpdate>, // Die Liste der Fortschritts-Updates
    pub p_id: Option<u32>,
    #[serde(rename = "isAttached")]
    pub is_attached: bool, //Für LiveLogs
    pub branch: String,
}

impl Default for RunnerInstance {
    fn default() -> Self {
        RunnerInstance {
            terminator: None,
            id: Uuid::new_v4(), // Oder ein Standardwert, den du verwenden möchtest
            progress_updates: Vec::new(),
            p_id: None,
            is_attached: false,
            branch: "".to_string(),
        }
    }
}

pub struct AppState {
    pub runner_instances: Arc<Mutex<Vec<RunnerInstance>>>,
}

impl NoRiskLaunchManifest {
    pub async fn load(app_data: &Path) -> Result<Self, Error> {
        // load the options from the file
        let options = serde_json::from_slice::<NoRiskLaunchManifest>(&fs::read(app_data.join("launch_manifest.json")).await?)?;
        Ok(options)
    }
    pub async fn store(&self, app_data: &Path) -> Result<(), Error> {
        let _ = fs::write(app_data.join("launch_manifest.json"), serde_json::to_string_pretty(&self)?).await?;
        debug!("Launch manifest was stored...");
        Ok(())
    }
}

impl NRCCache {
    pub async fn get_launch_manifest(branch: &str, norisk_token: &str, uuid: Uuid) -> Result<NoRiskLaunchManifest, Error> {
        let nrc_cache = LAUNCHER_DIRECTORY.data_dir().join("gameDir").join(branch).join("nrc_cache");
        match ApiEndpoints::launch_manifest(branch, norisk_token, uuid).await {
            Ok(manifest) => {
                fs::create_dir_all(&nrc_cache).await?;
                manifest.store(&nrc_cache).await?;
                Ok(manifest)
            }
            Err(error) => {
                error!("Error Loading Launch Manifest {:?}", error);
                let result = NoRiskLaunchManifest::load(&nrc_cache).await?;
                Ok(result)
            }
        }
    }

    pub async fn get_branches(options: LauncherOptions, credentials: Credentials) -> Result<Vec<String>, Error> {
        let path = LAUNCHER_DIRECTORY
            .data_dir()
            .join("nrc_cache")
            .join(if !options.experimental_mode { "branches.json" } else { "exp_branches.json" });

        match credentials.norisk_credentials.get_token(options.experimental_mode).await {
            Ok(token) => {
                match ApiEndpoints::branches(&token, &credentials.id.to_string()).await {
                    Ok(response) => {
                        if let Err(err) = fs::write(&path, serde_json::to_string_pretty(&response)?).await {
                            error!("Failed to store branches: {:?}", err);
                        }
                        debug!("Branches were stored...");
                        return Ok(response);
                    }
                    Err(error) => {
                        error!("Error Loading Branches from API: {:?}", error);
                    }
                }
            }
            Err(error) => {
                error!("Error Getting Token: {:?}", error);
            }
        }

        // Try reading from the cache file if API call or token retrieval fails
        match fs::read(&path).await {
            Ok(data) => {
                if let Ok(options) = serde_json::from_slice::<Vec<String>>(&data) {
                    return Ok(options);
                } else {
                    error!("Error deserializing branches from cache.");
                }
            }
            Err(err) => {
                error!("Error Reading Branches Cache: {:?}", err);
            }
        }

        // Return an empty vector as a fallback
        Ok(Vec::new())
    }

    pub fn get_pid() -> u32 {
        std::process::id()
    }

    pub async fn get_running_instances(app_state: tauri::State<'_, AppState>) -> Result<Vec<RunnerInstance>, Error> {
        let runner_instances = app_state.runner_instances.lock().unwrap();

        // Initialisiere `sysinfo` um die laufenden Prozesse zu überprüfen
        let mut system = System::new_all();
        system.refresh_all(); // Alle Prozesse und Systemdaten aktualisieren

        // Filtern der Instanzen, die entweder einen Terminator oder eine aktive Prozess-ID haben
        let response: Vec<RunnerInstance> = runner_instances
            .iter()
            .filter(|instance| {
                // Wenn ein Terminator vorhanden ist oder eine gültige, laufende Prozess-ID
                instance.terminator.is_some() || Self::is_running(&system, instance.p_id)
            })
            .map(|instance| RunnerInstance {
                terminator: None, // Terminator wird nicht serialisiert
                id: instance.id.clone(), // Die ID wird serialisiert
                progress_updates: instance.progress_updates.clone(),
                p_id: instance.p_id.clone(),
                is_attached: instance.terminator.is_some(), //Für LiveLogs
                branch: instance.branch.clone(),
            })
            .collect();

        Ok(response)
    }

    // Funktion zur Überprüfung, ob eine p_id zu einem aktiven Prozess gehört
    pub fn is_running(system: &System, pid: Option<u32>) -> bool {
        if let Some(pid) = pid {
            if let Some(game_process) = system.process(Pid::from(pid as usize)) {
                return game_process.name().contains("java");
            }
        }
        false
    }

    fn load_running_instances(instances_path: &Path) -> Vec<RunnerInstance> {
        // Prüfe, ob die Instanzen-Datei existiert
        if instances_path.exists() {
            match std::fs::read_to_string(instances_path) {
                Ok(content) => {
                    // Deserialisiere den Inhalt zu einer Liste von RunnerInstances
                    let mut instances: Vec<RunnerInstance> = serde_json::from_str(&content).unwrap_or_else(|err| {
                        error!("Fehler beim Parsen der gespeicherten Instanzen: {}", err);
                        Vec::new()
                    });

                    // Prüfe jede Instanz, ob der zugehörige Prozess existiert
                    let mut system = System::new_all();
                    system.refresh_all();

                    // Behalte nur die Instanzen, deren Prozess "java" enthält und existiert
                    instances.retain(|instance| { return Self::is_running(&system, instance.p_id); });
                    instances
                }
                Err(err) => {
                    error!("Fehler beim Lesen der Datei: {}", err);
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        }
    }


    pub fn store_running_instances(instances: &Arc<Mutex<Vec<RunnerInstance>>>) -> Result<(), crate::error::Error> {
        let instances_guard = instances.lock().unwrap();
        //nicht pretty speichern für maximale performance und größe
        let serialized = serde_json::to_string(&*instances_guard)?;
        std::fs::create_dir_all(LAUNCHER_DIRECTORY.data_dir().join("nrc_cache"))?;
        std::fs::write(LAUNCHER_DIRECTORY.data_dir().join("nrc_cache").join("running_instances.json"), serialized)?;
        Ok(())
    }

    pub fn initialize_app_state(app: &tauri::App) {
        let runner_instances = Self::load_running_instances(&LAUNCHER_DIRECTORY.data_dir().join("nrc_cache").join("running_instances.json"));
        debug!("Found {:?} Last Instances",runner_instances.len());
        let instances = Arc::new(Mutex::new(runner_instances));
        app.manage(AppState {
            runner_instances: instances.clone(),
        });
        // Store the instances immediately after loading
        NRCCache::store_running_instances(&instances).ok();
    }
}
