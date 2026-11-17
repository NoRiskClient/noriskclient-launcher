pub mod convert;
pub mod logfile;
mod upload;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use tauri::AppHandle;
use uuid::Uuid;

use crate::commands::request_context::{account_ctx, AccountCtx};
use crate::error::{AppError, CommandError};
use crate::minecraft::api::share_api::{
    Share, ShareApi, ShareChoices, ShareDetails, ShareExpiry, UploadRequest,
};
use crate::state::State;
use upload::Progress;

#[derive(Default)]
struct About<'a> {
    title: Option<&'a str>,
    server: Option<&'a str>,
    expiry: ShareExpiry,
}

enum Payload<'a> {
    File(&'a Path),
    Text(String),
}

fn refused(key: &str, message: impl Into<String>) -> CommandError {
    CommandError {
        message: message.into(),
        kind: "Share".into(),
        translatable_key: Some(key.into()),
        ..Default::default()
    }
}

#[tauri::command]
pub async fn share_clip(
    app: AppHandle,
    path: PathBuf,
    progress_id: String,
    options: Option<ShareDetails>,
) -> Result<Share, CommandError> {
    let options = options.unwrap_or_default();
    let state = State::get().await?;
    let clips = state.config_manager.get_config().await.clips;
    let clip = crate::utils::clip_library::resolve_clip(&clips.resolved_output_dir(), &path)?;
    let progress = Progress::new(&app, &progress_id);
    let ctx = account_ctx(None).await?;
    let details = {
        let clip = clip.clone();
        tokio::task::spawn_blocking(move || crate::utils::clip_library::read_details(&clip))
            .await
            .ok()
            .flatten()
    };
    let server = details
        .as_ref()
        .and_then(|d| d.server.clone())
        .filter(|_| !options.hide_server);

    let converted = if convert::shareable(&clip).await {
        None
    } else {
        progress.report("converting", 0, 0);
        let seconds = details.map(|d| f64::from(d.duration_seconds));
        Some(convert::convert(&state, &clips, &clip, seconds, ctx.is_experimental, &progress).await?)
    };
    let upload = converted.as_ref().map_or(clip.as_path(), |c| c.path());
    let name = file_name(&clip);
    let payload = Payload::File(upload);
    let about = About {
        title: options.title(),
        server: server.as_deref(),
        expiry: options.expiry,
    };
    share(&ctx, &progress, payload, &name, about, "video", "video/mp4").await
}

#[tauri::command]
pub async fn share_screenshot(
    app: AppHandle,
    profile_id: Uuid,
    path: PathBuf,
    progress_id: String,
    options: Option<ShareDetails>,
) -> Result<Share, CommandError> {
    let options = options.unwrap_or_default();
    let state = State::get().await?;
    let folder = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?
        .join("screenshots");
    let screenshot = inside_screenshots(&folder, &path)?;
    let extension = screenshot
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let content_type = match extension.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => {
            return Err(AppError::InvalidInput(
                "only PNG and JPEG screenshots can be shared".into(),
            )
            .into())
        }
    };
    let progress = Progress::new(&app, &progress_id);
    let ctx = account_ctx(None).await?;
    let name = file_name(&screenshot);
    let about = About {
        title: options.title(),
        server: None,
        expiry: options.expiry,
    };
    share(&ctx, &progress, Payload::File(&screenshot), &name, about, "image", content_type).await
}

#[tauri::command]
pub async fn share_choices() -> Result<ShareChoices, CommandError> {
    let ctx = account_ctx(None).await?;
    Ok(ShareApi::choices(&ctx.token, ctx.is_experimental).await?)
}

#[tauri::command]
pub async fn share_log(app: AppHandle, content: String, name: String) -> Result<Share, CommandError> {
    let ctx = account_ctx(None).await?;
    let max_bytes = ShareApi::limits(ctx.is_experimental)
        .await
        .inspect_err(|e| log::warn!("Could not read the upload limits: {e}"))
        .ok()
        .and_then(|limits| limits.max_text_bytes)
        .unwrap_or(logfile::DEFAULT_MAX_BYTES);
    let text = tokio::task::spawn_blocking(move || logfile::prepare(&content, max_bytes as usize))
        .await
        .map_err(AppError::Task)?;
    if text.trim().is_empty() {
        return Err(refused("share.errors.empty_log", "the log is empty"));
    }
    let name = match name.trim() {
        "" => "latest.log",
        name => name,
    };
    let progress = Progress::new(&app, "log");
    share(&ctx, &progress, Payload::Text(text), name, About::default(), "text", "text/plain").await
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn inside_screenshots(folder: &Path, path: &Path) -> crate::error::Result<PathBuf> {
    let folder = folder
        .canonicalize()
        .map_err(|e| AppError::Other(format!("the screenshot folder is unreadable: {e}")))?;
    let path = path
        .canonicalize()
        .map_err(|e| AppError::Other(format!("that screenshot no longer exists: {e}")))?;
    if !path.starts_with(&folder) || !path.is_file() {
        return Err(AppError::Other(
            "refusing to share a file outside the screenshot folder".into(),
        ));
    }
    Ok(path)
}

async fn share(
    ctx: &AccountCtx,
    progress: &Progress<'_>,
    payload: Payload<'_>,
    name: &str,
    about: About<'_>,
    kind: &'static str,
    content_type: &'static str,
) -> Result<Share, CommandError> {
    let size = match &payload {
        Payload::File(path) => tokio::fs::metadata(path).await.map_err(AppError::Io)?.len(),
        Payload::Text(text) => text.len() as u64,
    };

    progress.report("uploading", 0, size);
    let ticket = ShareApi::start_upload(
        &ctx.token,
        ctx.is_experimental,
        &UploadRequest {
            kind,
            content_type,
            size_bytes: size as i64,
            name,
        },
    )
    .await?;

    match payload {
        Payload::File(path) => {
            let file = tokio::fs::File::open(path).await.map_err(AppError::Io)?;
            let sent = Arc::new(AtomicU64::new(0));
            let put = ShareApi::put_file(&ticket, size, upload::file_body(file, size, sent.clone()));
            upload::watch_upload(put, &sent, size, |bytes| progress.report("uploading", bytes, size))
                .await?;
        }
        Payload::Text(text) => ShareApi::put_file(&ticket, size, text.into()).await?,
    }

    progress.report("checking", size, size);
    let medium = ShareApi::complete_upload(&ctx.token, ctx.is_experimental, &ticket.id).await?;
    let share = ShareApi::create_share(
        &ctx.token,
        ctx.is_experimental,
        &medium.id,
        about.title,
        about.server,
        about.expiry,
    )
    .await?;

    log::info!("Shared {name} as {}", share.page_url);
    crate::commands::analytics_command::track("media_shared", serde_json::json!({ "kind": kind }));
    Ok(share)
}
