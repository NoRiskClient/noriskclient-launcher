use std::path::Path;
use std::sync::{Arc, Mutex};

use log::{debug, info};
use log::error;
use serde::Deserialize;
use sysinfo::{Pid, ProcessExt, System, SystemExt};
use tauri::{Manager, State};
use tokio::fs;
use uuid::Uuid;

use crate::app::api::{ApiEndpoints, LaunchManifest, NoRiskLaunchManifest};
use crate::error::{Error, ErrorKind};
use crate::LAUNCHER_DIRECTORY;
use crate::minecraft::progress::ProgressUpdate;

pub struct NRCCache {}

#[derive(serde::Serialize, Deserialize, Debug, Clone)] // Damit diese Struktur serialisierbar ist
pub struct OutputData {
    pub id: Uuid,
    pub text: String
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
    pub is_attached: bool //Für LiveLogs
}

impl Default for RunnerInstance {
    fn default() -> Self {
        RunnerInstance {
            terminator: None,
            id: Uuid::new_v4(), // Oder ein Standardwert, den du verwenden möchtest
            progress_updates: Vec::new(),
            p_id: None,
            is_attached: false
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
        let nrc_cache = LAUNCHER_DIRECTORY.data_dir().join("nrc_cache");
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
                is_attached: instance.terminator.is_some() //Für LiveLogs
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
        let serialized = serde_json::to_string_pretty(&*instances_guard)?;
        std::fs::write(LAUNCHER_DIRECTORY.data_dir().join("running_instances.json"), serialized)?;
        Ok(())
    }

    pub fn initialize_app_state(app: &tauri::App) {
        let runner_instances = Self::load_running_instances(&LAUNCHER_DIRECTORY.data_dir().join("running_instances.json"));
        debug!("Found {:?} Last Instances",runner_instances.len());
        let instances = Arc::new(Mutex::new(runner_instances));
        app.manage(AppState {
            runner_instances: instances.clone(),
        });
        // Store the instances immediately after loading
        NRCCache::store_running_instances(&instances).unwrap();
    }
}
