use crate::error::{AppError, CommandError};
use crate::minecraft::api::payload_cms_api::{
    NeedsTestingResponse, PayloadCmsApi, SubmitTestVoteRequest, SubmitTestVoteResponse,
};
use crate::state::state_manager::State;
use log::{debug, info};
use serde::Serialize;
use tauri::Manager;

const WINDOW_LABEL: &str = "tester_window";

#[derive(Serialize)]
pub struct TesterQueueCount {
    pub count: i64,
}

struct TesterAuth {
    uuid: String,
    token: String,
    is_experimental: bool,
}

async fn resolve_auth() -> Result<Option<TesterAuth>, CommandError> {
    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    let Some(active) = state.minecraft_account_manager_v2.get_active_account().await? else {
        return Ok(None);
    };
    let uuid = active.id.to_string();
    let token = active
        .norisk_credentials
        .get_token_for_mode(is_experimental)
        .map_err(AppError::from)?;
    Ok(Some(TesterAuth {
        uuid,
        token,
        is_experimental,
    }))
}

async fn require_auth() -> Result<TesterAuth, CommandError> {
    resolve_auth()
        .await?
        .ok_or_else(|| AppError::Other("No active account".into()).into())
}

#[tauri::command]
pub async fn fetch_tester_queue_count() -> Result<TesterQueueCount, CommandError> {
    let Some(auth) = resolve_auth().await? else {
        return Ok(TesterQueueCount { count: 0 });
    };
    let resp =
        PayloadCmsApi::fetch_needs_testing(&auth.uuid, &auth.token, auth.is_experimental).await?;
    let review_count = resp
        .docs
        .iter()
        .filter(|d| d.get("pendingKind").and_then(|k| k.as_str()) == Some("review"))
        .count() as i64;
    debug!(
        "[Tester] review queue count for {}: {} ({} total)",
        auth.uuid, review_count, resp.total_docs
    );
    Ok(TesterQueueCount {
        count: review_count,
    })
}

#[tauri::command]
pub async fn fetch_tester_queue() -> Result<NeedsTestingResponse, CommandError> {
    let auth = require_auth().await?;
    let resp =
        PayloadCmsApi::fetch_needs_testing(&auth.uuid, &auth.token, auth.is_experimental).await?;
    Ok(resp)
}

#[tauri::command]
pub async fn submit_tester_vote(
    issue_id: String,
    kind: String,
    vote: String,
    description: Option<String>,
) -> Result<SubmitTestVoteResponse, CommandError> {
    let auth = require_auth().await?;
    let body = SubmitTestVoteRequest {
        issue_id,
        uuid: auth.uuid,
        kind,
        vote,
        description,
    };
    let resp = PayloadCmsApi::submit_test_vote(body, &auth.token, auth.is_experimental).await?;
    Ok(resp)
}

#[tauri::command]
pub async fn open_tester_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), CommandError> {
    let other = |action: &str, e: tauri::Error| {
        CommandError::from(AppError::Other(format!(
            "Failed to {} tester window: {}",
            action, e
        )))
    };

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.show().map_err(|e| other("show", e))?;
        window.unminimize().map_err(|e| other("unminimize", e))?;
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
        window.set_focus().map_err(|e| other("focus", e))?;
        return Ok(());
    }

    info!("[Tester] Opening tester window");
    tauri::WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        tauri::WebviewUrl::App("tester-window.html".into()),
    )
    .title("NoRisk Tester Queue")
    .inner_size(1100.0, 760.0)
    .min_inner_size(800.0, 600.0)
    .decorations(false)
    .center()
    .visible(false)
    .build()
    .map_err(|e| CommandError::from(AppError::Other(e.to_string())))?;

    Ok(())
}
