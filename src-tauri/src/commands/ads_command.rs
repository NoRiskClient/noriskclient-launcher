use crate::ads::policy::{AdSize, ConsentAction, ConsentMode};
use crate::ads::{self, AdRect};
use crate::error::{AppError, CommandError};
use std::collections::BTreeMap;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn ads_refresh(app: AppHandle) -> Result<BTreeMap<String, AdSize>, CommandError> {
    Ok(ads::configure(&app).await)
}

/// Slot bounds are window-relative, so only the slot's own window may report them.
fn from_host(window: &tauri::Window, slot: &str) -> bool {
    let hosted = crate::ads::policy::slot_window(slot) == window.label();
    if !hosted {
        log::warn!("[Ads] Ignored slot {} reported by window {}", slot, window.label());
    }
    hosted
}

#[tauri::command]
pub async fn ads_set_bounds(
    app: AppHandle,
    window: tauri::Window,
    slot: String,
    rect: AdRect,
) -> Result<(), CommandError> {
    if from_host(&window, &slot) {
        ads::set_slot(&app, slot, rect).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ads_cover(app: AppHandle, window: tauri::Window, slot: String) -> Result<(), CommandError> {
    if from_host(&window, &slot) {
        ads::cover_slot(&app, &slot).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ads_hide(app: AppHandle, window: tauri::Window, slot: String) -> Result<(), CommandError> {
    if from_host(&window, &slot) {
        ads::clear_slot(&app, &slot).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ads_show_consent(app: AppHandle) -> Result<(), CommandError> {
    ads::show_consent(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn ads_consent_action(app: AppHandle, action: String) -> Result<(), CommandError> {
    let action = ConsentAction::parse(&action)
        .ok_or_else(|| CommandError::from(AppError::Other("Unknown privacy answer".to_string())))?;
    ads::consent_action(&app, action);
    Ok(())
}

#[tauri::command]
pub fn ads_status() -> ads::AdsStatus {
    ads::status()
}

#[tauri::command]
pub fn ad_privacy(app: AppHandle, purposes: Vec<u32>) {
    ads::record_privacy(&app, &purposes);
}

#[tauri::command]
pub fn ad_clicked() {
    ads::record_click();
}

#[tauri::command]
pub fn ad_consent_mode(app: AppHandle, mode: String) {
    if let Some(mode) = ConsentMode::parse(&mode) {
        ads::page_consent_mode(&app, mode);
    }
}

#[tauri::command]
pub fn open_ad_link(app: AppHandle, url: String) -> Result<(), CommandError> {
    let Some(url) = ads::admit_link(&app, &url) else {
        log::warn!("[Ads] Ad link rejected");
        return Ok(());
    };
    log::info!("[Ads] Opening ad link in the browser");
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| CommandError::from(AppError::Other(format!("Failed to open ad link: {}", e))))
}
