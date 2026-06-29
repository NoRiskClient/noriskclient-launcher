use crate::commands::request_context::account_ctx;
use crate::error::CommandError;
use crate::minecraft::api::cosmetic_api::CosmeticApi;
use crate::minecraft::api::cosmetic_icons::{
    creator_code_icon_url, icon_url_for_uuid, CREATOR_CODE_ICON_UUID,
};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::dto::cosmetic_icon::{
    CreatorCodeRewards, CustomIconInfo, SupportACreatorCode,
};
use serde::Serialize;

const CREATOR_CODE_VALID_MS: u64 = 14 * 24 * 60 * 60 * 1000;

#[derive(Serialize)]
pub struct SelectedIconDto {
    pub url: Option<String>,
    pub plus: bool,
}

#[tauri::command]
pub async fn get_selected_player_icon(
    player_identifier: String,
) -> Result<SelectedIconDto, CommandError> {
    let ctx = account_ctx(None).await?;
    let uuid = MinecraftApiService::new()
        .resolve_uuid(&player_identifier)
        .await?;
    let api = CosmeticApi::new();

    let current_icon = api
        .get_player_icon(&ctx.token, &uuid, ctx.is_experimental)
        .await
        .ok()
        .and_then(|v| serde_json::from_value::<CustomIconInfo>(v).ok())
        .and_then(|i| i.current_icon);

    let plus = api.get_plus_status(&uuid).await.unwrap_or(false);

    let mut url = current_icon.as_deref().and_then(|i| icon_url_for_uuid(Some(i)));

    if current_icon.as_deref() == Some(CREATOR_CODE_ICON_UUID) {
        if let Some(code) = active_creator_code(&api, &ctx.token, ctx.is_experimental)
            .await
            .and_then(|c| c.code)
        {
            if creator_code_icon_unlocked(&api, &code).await {
                url = Some(creator_code_icon_url(&code));
            }
        }
    }

    Ok(SelectedIconDto { url, plus })
}

async fn active_creator_code(
    api: &CosmeticApi,
    token: &str,
    is_experimental: bool,
) -> Option<SupportACreatorCode> {
    let shop_user = api.get_shop_user(token, is_experimental).await.ok()?;
    let value = shop_user.get("supportACreatorCode")?.clone();
    serde_json::from_value(value).ok()
}

async fn creator_code_icon_unlocked(api: &CosmeticApi, code: &str) -> bool {
    api.get_creator_code_rewards(code)
        .await
        .ok()
        .and_then(|v| serde_json::from_value::<CreatorCodeRewards>(v).ok())
        .map(|r| r.rewards.creator_code_icon.is_unlocked)
        .unwrap_or(false)
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
    let info = match active_creator_code(&CosmeticApi::new(), &ctx.token, ctx.is_experimental).await
    {
        Some(c) => c,
        None => return Ok(None),
    };
    let code = match info.code {
        Some(c) if !c.is_empty() => c,
        _ => return Ok(None),
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let is_valid = info
        .add_timestamp
        .map(|ts| now_ms.saturating_sub(ts) < CREATOR_CODE_VALID_MS)
        .unwrap_or(false);
    let has_valid_icon = info.has_valid_icon;

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
