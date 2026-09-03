use crate::error::{AppError, CommandError};
use crate::integrations::launcher_import::model::{
    DetectedLauncher, ExternalInstancePreview, ExternalInstanceRef, ExternalLauncher,
    ImportSelection,
};
use crate::integrations::launcher_import::{control, detect, pipeline, preview};
use crate::state::State;
use serde::Deserialize;
use std::path::PathBuf;
use uuid::Uuid;

#[tauri::command]
pub async fn scan_external_launchers() -> Result<Vec<DetectedLauncher>, CommandError> {
    Ok(detect::scan_all().await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddLauncherRootParams {
    pub path: String,
}

#[tauri::command]
pub async fn add_external_launcher_root(
    params: AddLauncherRootParams,
) -> Result<Option<DetectedLauncher>, CommandError> {
    Ok(detect::identify_launcher_at(&PathBuf::from(params.path)).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListExternalInstancesParams {
    pub launcher: ExternalLauncher,
    pub root: String,
}

#[tauri::command]
pub async fn list_external_instances(
    params: ListExternalInstancesParams,
) -> Result<Vec<ExternalInstanceRef>, CommandError> {
    let (adapter, resolved) = detect::open(params.launcher, &PathBuf::from(params.root)).await?;

    Ok(adapter.list_instances(&resolved).await?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewExternalInstanceParams {
    pub launcher: ExternalLauncher,
    pub root: String,
    pub instance_dir: String,
    #[serde(default)]
    pub selection: Option<ImportSelection>,
    #[serde(default)]
    pub resolve_mods: bool,
}

#[tauri::command]
pub async fn preview_external_instance(
    params: PreviewExternalInstanceParams,
) -> Result<ExternalInstancePreview, CommandError> {
    Ok(preview::preview_instance(
        params.launcher,
        &PathBuf::from(params.root),
        &PathBuf::from(params.instance_dir),
        preview::PreviewOptions {
            selection: params.selection.unwrap_or_default(),
            resolve_mods: params.resolve_mods,
        },
    )
    .await?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalInstanceParams {
    pub launcher: ExternalLauncher,
    pub root: String,
    pub instance_dir: String,
    #[serde(default)]
    pub selection: ImportSelection,
    pub name_override: Option<String>,
    pub group_override: Option<String>,
    pub norisk_pack_id: Option<String>,
    #[serde(default)]
    pub clear_norisk_pack: bool,
    pub event_id: Option<String>,
}

#[tauri::command]
pub async fn import_external_instance(
    params: ImportExternalInstanceParams,
) -> Result<Uuid, CommandError> {
    let event_id = params
        .event_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok());

    let profile_id = pipeline::import_instance(pipeline::ImportRequest {
        launcher: params.launcher,
        root: PathBuf::from(params.root),
        instance_dir: PathBuf::from(params.instance_dir),
        selection: params.selection,
        name_override: params.name_override,
        group_override: params.group_override,
        event_id,
    })
    .await?;

    let state = State::get().await?;

    if params.norisk_pack_id.is_some() || params.clear_norisk_pack {
        if let Ok(mut profile) = state.profile_manager.get_profile(profile_id).await {
            profile.selected_norisk_pack_id = if params.clear_norisk_pack {
                None
            } else {
                params.norisk_pack_id
            };
            if let Err(e) = state
                .profile_manager
                .update_profile(profile_id, profile)
                .await
            {
                log::error!(
                    "Failed to apply the NoRisk pack choice to imported profile {}: {}",
                    profile_id,
                    e
                );
            }
        }
    }

    let mut props = std::collections::HashMap::new();
    props.insert(
        "launcher".to_string(),
        serde_json::Value::String(params.launcher.as_str().to_string()),
    );
    crate::commands::analytics_command::track_event("external_instance_imported", props);

    if let Err(e) = state.event_state.trigger_profile_update(profile_id).await {
        log::error!(
            "Failed to emit TriggerProfileUpdate for imported profile {}: {}",
            profile_id,
            e
        );
    }

    Ok(profile_id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExternalImportParams {
    pub event_id: String,
}

#[tauri::command]
pub async fn cancel_external_import(
    params: CancelExternalImportParams,
) -> Result<bool, CommandError> {
    let event_id = Uuid::parse_str(&params.event_id)
        .map_err(|e| AppError::Other(format!("Invalid event id: {}", e)))?;

    Ok(control::cancel(event_id))
}
