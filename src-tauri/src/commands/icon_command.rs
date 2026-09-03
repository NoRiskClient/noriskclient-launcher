use crate::commands::request_context::account_ctx;
use crate::error::{AppError, CommandError};
use crate::minecraft::api::core_api::CoreApi;
use crate::minecraft::api::cosmetic_icons::{
    creator_code_icon_url, icon_url_for_uuid, CREATOR_CODE_ICON_UUID,
};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::dto::norisk_user::NoRiskUserMinimal;
use crate::state::state_manager::State;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const CREATOR_CODE_VALID_MS: u64 = 14 * 24 * 60 * 60 * 1000;

async fn minimal_user(target: &Uuid) -> Result<NoRiskUserMinimal, CommandError> {
    let ctx = account_ctx(None).await?;
    let requester = ctx
        .account_uuid
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;
    CoreApi::new()
        .get_minimal_user_info(&ctx.token, target, &requester, ctx.is_experimental)
        .await
        .map_err(CommandError::from)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SelectedIconDto {
    pub url: Option<String>,
    pub plus: bool,
}

#[tauri::command]
pub async fn get_selected_player_icon(
    player_identifier: String,
) -> Result<SelectedIconDto, CommandError> {
    let target = MinecraftApiService::new()
        .resolve_uuid(&player_identifier)
        .await?;
    let state = State::get().await?;
    let user = match minimal_user(&target).await {
        Ok(u) => u,
        Err(_) => {
            return Ok(state
                .content_cache
                .get_player_icon::<SelectedIconDto>(&target)
                .await
                .unwrap_or(SelectedIconDto { url: None, plus: false }))
        }
    };

    let icon = selected_icon_from_user(&user);
    state
        .content_cache
        .put_player_icon(&target, &icon)
        .await;
    Ok(icon)
}

#[tauri::command]
pub async fn get_selected_player_icon_cached(
    player_identifier: String,
) -> Result<Option<SelectedIconDto>, CommandError> {
    let target = MinecraftApiService::new()
        .resolve_uuid(&player_identifier)
        .await?;
    let state = State::get().await?;
    Ok(state
        .content_cache
        .get_player_icon::<SelectedIconDto>(&target)
        .await)
}

fn selected_icon_from_user(user: &NoRiskUserMinimal) -> SelectedIconDto {
    let current_icon = user.custom_icon_info.current_icon.as_deref();
    let mut url = current_icon.and_then(|i| icon_url_for_uuid(Some(i)));

    if current_icon == Some(CREATOR_CODE_ICON_UUID) {
        if let Some(scc) = user.support_a_creator_code.as_ref() {
            if scc.has_valid_icon {
                if let Some(code) = scc.code.as_deref() {
                    url = Some(creator_code_icon_url(code));
                }
            }
        }
    }

    SelectedIconDto {
        url,
        plus: user.is_norisk_plus(),
    }
}

#[derive(Serialize)]
pub struct ActiveCreatorCodeDto {
    pub code: String,
    #[serde(rename = "isValid")]
    pub is_valid: bool,
    #[serde(rename = "hasValidIcon")]
    pub has_valid_icon: bool,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
}

#[tauri::command]
pub async fn get_active_creator_code() -> Result<Option<ActiveCreatorCodeDto>, CommandError> {
    let ctx = account_ctx(None).await?;
    let requester = ctx
        .account_uuid
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;
    let user = match CoreApi::new()
        .get_minimal_user_info(&ctx.token, &requester, &requester, ctx.is_experimental)
        .await
    {
        Ok(u) => u,
        Err(_) => return Ok(None),
    };

    let scc = match user.support_a_creator_code {
        Some(s) => s,
        None => return Ok(None),
    };
    let code = match scc.code {
        Some(c) if !c.is_empty() => c,
        _ => return Ok(None),
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let is_valid = scc
        .add_timestamp
        .map(|ts| now_ms.saturating_sub(ts) < CREATOR_CODE_VALID_MS)
        .unwrap_or(false);
    let has_valid_icon = scc.has_valid_icon;

    Ok(Some(ActiveCreatorCodeDto {
        icon_url: if has_valid_icon {
            Some(creator_code_icon_url(&code))
        } else {
            None
        },
        code,
        is_valid,
        has_valid_icon,
    }))
}
