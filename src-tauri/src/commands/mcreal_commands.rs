use crate::commands::request_context::account_ctx;
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
use crate::minecraft::api::mcreal_api::{
    McRealApi, McRealCommentWithRating, McRealCommentsHolder, McRealPostWithRating, McRealProfile,
    McRealRating, McRealUserClient,
};
use log::debug;
use std::path::PathBuf;

/// Resolves (norisk_token, account_uuid, is_experimental) for the active account.
/// McReal routes always need the uuid as query param, hence the thin wrapper
/// around the shared account_ctx helper.
async fn mcreal_auth() -> Result<(String, String, bool), CommandError> {
    let ctx = account_ctx(None).await?;
    let uuid = ctx
        .account_uuid
        .ok_or(AppError::AccountError(
            "No active account found for McReal.".to_string(),
        ))?
        .to_string();
    Ok((ctx.token, uuid, ctx.is_experimental))
}

#[tauri::command]
pub async fn get_mcreal_feed(
    friends_only: bool,
    partners_only: Option<bool>,
    page: u32,
    sort: Option<String>,
) -> Result<Vec<McRealPostWithRating>, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_posts(
        &token,
        &uuid,
        is_experimental,
        friends_only,
        partners_only.unwrap_or(false),
        page,
        sort.as_deref().unwrap_or("NEWEST"),
    )
    .await?)
}

#[tauri::command]
pub async fn get_mcreal_today_post() -> Result<Option<McRealPostWithRating>, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_today_post(&token, &uuid, is_experimental).await?)
}

#[tauri::command]
pub async fn get_mcreal_post(post_id: String) -> Result<McRealPostWithRating, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_post(&token, &uuid, is_experimental, &post_id).await?)
}

#[tauri::command]
pub async fn delete_mcreal_post(
    post_id: String,
) -> Result<Vec<McRealPostWithRating>, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::delete_post(&token, &uuid, is_experimental, &post_id).await?)
}

#[derive(serde::Serialize)]
pub struct McRealImageResult {
    pub path: String,
    pub blurred: bool,
}

/// Downloads post media into the local cache and returns the absolute file
/// path (served to the webview via the asset protocol).
///
/// Only unblurred media is cached: the blurred variant is what the server
/// sends while the viewer hasn't posted today, and it must not shadow the
/// real image once the viewer has posted.
#[tauri::command]
pub async fn get_mcreal_post_image(
    post_id: String,
    image_type: String,
) -> Result<McRealImageResult, CommandError> {
    if image_type != "primary" && image_type != "secondary" {
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid McReal image type: {}",
            image_type
        ))));
    }

    let cache_dir: PathBuf = LAUNCHER_DIRECTORY.meta_dir().join("mcreal_cache");
    let file_path = cache_dir.join(format!("{}_{}.webp", post_id, image_type));
    let blurred_path = cache_dir.join(format!("{}_{}_blurred.webp", post_id, image_type));

    if file_path.is_file() {
        debug!("[McReal] Image cache hit: {:?}", file_path);
        return Ok(McRealImageResult {
            path: file_path.to_string_lossy().to_string(),
            blurred: false,
        });
    }

    let (token, uuid, is_experimental) = mcreal_auth().await?;
    let (bytes, blurred) =
        McRealApi::get_post_image(&token, &uuid, is_experimental, &post_id, &image_type).await?;

    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| AppError::Other(format!("Failed to create McReal cache dir: {}", e)))?;

    let target = if blurred { &blurred_path } else { &file_path };
    tokio::fs::write(target, &bytes)
        .await
        .map_err(|e| AppError::Other(format!("Failed to write McReal image: {}", e)))?;

    Ok(McRealImageResult {
        path: target.to_string_lossy().to_string(),
        blurred,
    })
}

#[tauri::command]
pub async fn rate_mcreal_post(
    post_id: String,
    is_positive: bool,
) -> Result<McRealRating, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::rate_post(&token, &uuid, is_experimental, &post_id, is_positive).await?)
}

#[tauri::command]
pub async fn unrate_mcreal_post(post_id: String) -> Result<(), CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::unrate_post(&token, &uuid, is_experimental, &post_id).await?)
}

#[tauri::command]
pub async fn get_mcreal_comments(
    post_id: String,
    page: Option<u32>,
    parent_comment_id: Option<String>,
) -> Result<McRealCommentsHolder, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_comments(
        &token,
        &uuid,
        is_experimental,
        &post_id,
        page.unwrap_or(0),
        parent_comment_id.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn add_mcreal_comment(
    post_id: String,
    text: String,
    parent_comment_id: Option<String>,
) -> Result<McRealCommentWithRating, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::add_comment(
        &token,
        &uuid,
        is_experimental,
        &post_id,
        &text,
        parent_comment_id.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn delete_mcreal_comment(comment_id: String) -> Result<(), CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::delete_comment(&token, &uuid, is_experimental, &comment_id).await?)
}

#[tauri::command]
pub async fn rate_mcreal_comment(
    comment_id: String,
    is_positive: bool,
) -> Result<McRealRating, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::rate_comment(&token, &uuid, is_experimental, &comment_id, is_positive).await?)
}

#[tauri::command]
pub async fn unrate_mcreal_comment(comment_id: String) -> Result<(), CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::unrate_comment(&token, &uuid, is_experimental, &comment_id).await?)
}

#[tauri::command]
pub async fn get_mcreal_user(zone_id: Option<String>) -> Result<McRealUserClient, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_user(&token, &uuid, is_experimental, zone_id.as_deref()).await?)
}

#[tauri::command]
pub async fn get_mcreal_profile(user_uuid: String) -> Result<McRealProfile, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::get_profile(&token, &uuid, is_experimental, &user_uuid).await?)
}

#[tauri::command]
pub async fn follow_mcreal_user(user_uuid: String) -> Result<(), CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::follow(&token, &uuid, is_experimental, &user_uuid).await?)
}

#[tauri::command]
pub async fn unfollow_mcreal_user(user_uuid: String) -> Result<(), CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;
    Ok(McRealApi::unfollow(&token, &uuid, is_experimental, &user_uuid).await?)
}

/// Uploads a new McReal post from two local image files.
#[tauri::command]
pub async fn upload_mcreal_post(
    primary_path: String,
    secondary_path: String,
    title: Option<String>,
    friends_only: Option<bool>,
    server_ip: Option<String>,
) -> Result<Vec<McRealPostWithRating>, CommandError> {
    let (token, uuid, is_experimental) = mcreal_auth().await?;

    let read_image = |path: String| async move {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| AppError::Other(format!("Failed to read image {}: {}", path, e)))?;
        let mime = match path.rsplit('.').next().map(|e| e.to_lowercase()).as_deref() {
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            other => {
                return Err(AppError::Other(format!(
                    "Unsupported McReal image format: {:?}",
                    other
                )))
            }
        };
        Ok::<(Vec<u8>, &'static str), AppError>((bytes, mime))
    };

    let (primary, primary_mime) = read_image(primary_path).await?;
    let (secondary, secondary_mime) = read_image(secondary_path).await?;

    Ok(McRealApi::upload_post(
        &token,
        &uuid,
        is_experimental,
        primary,
        primary_mime,
        secondary,
        secondary_mime,
        title.as_deref(),
        friends_only.unwrap_or(true),
        server_ip.as_deref(),
    )
    .await?)
}
