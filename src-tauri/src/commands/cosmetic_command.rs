use crate::commands::request_context::account_ctx;
use crate::error::CommandError;
use crate::minecraft::api::cosmetic_api::CosmeticApi;
use crate::minecraft::api::cosmetic_icons::{
    creator_code_icon_url, icon_url_for_uuid, CREATOR_CODE_ICON_UUID,
};
use crate::minecraft::api::cosmetic_pack_api::{
    resolve_pack_cosmetic as api_resolve_pack_cosmetic, resolve_pack_emote as api_resolve_pack_emote,
    CosmeticAssetUrlsDto, EmoteAssetUrlsDto, ResolvedCosmeticDto,
};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::dto::cosmetic_outfit::{
    CosmeticRealOutfit, CosmeticSettings, CustomTextureSource,
};
use crate::minecraft::dto::minecraft_profile::TexturesData;
use crate::state::state_manager::State;
use serde::Serialize;
use serde_json::Value;

const PACK_ID: &str = "norisk-prod";
const ZERO_UUID: &str = "00000000-0000-0000-0000-000000000000";
const CREATOR_CODE_VALID_MS: u64 = 14 * 24 * 60 * 60 * 1000;

#[tauri::command]
pub async fn resolve_pack_cosmetic(
    cosmetic_id: String,
    settings: Option<CosmeticSettings>,
) -> Result<Option<ResolvedCosmeticDto>, CommandError> {
    let state = State::get().await?;
    let pack = state
        .cosmetic_pack_manager
        .get_or_load(PACK_ID)
        .await
        .map_err(CommandError::from)?;
    Ok(api_resolve_pack_cosmetic(&pack, &cosmetic_id, settings.as_ref()).await)
}

#[tauri::command]
pub async fn resolve_pack_emote(
    slug: String,
) -> Result<Option<EmoteAssetUrlsDto>, CommandError> {
    let state = State::get().await?;
    let pack = state
        .cosmetic_pack_manager
        .get_or_load(PACK_ID)
        .await
        .map_err(CommandError::from)?;
    Ok(api_resolve_pack_emote(&pack, &slug))
}

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
    let cosmetic_api = CosmeticApi::new();

    let current_icon = cosmetic_api
        .get_player_icon(&ctx.token, &uuid, ctx.is_experimental)
        .await
        .ok()
        .and_then(|v| {
            v.get("currentIcon")
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
        });

    let plus = cosmetic_api.get_plus_status(&uuid).await.unwrap_or(false);

    let mut url = current_icon.as_deref().and_then(|i| icon_url_for_uuid(Some(i)));

    if current_icon.as_deref() == Some(CREATOR_CODE_ICON_UUID) {
        if let Some(code) =
            active_creator_code_value(&cosmetic_api, &ctx.token, ctx.is_experimental)
                .await
                .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()))
        {
            if creator_code_icon_unlocked(&cosmetic_api, &code).await {
                url = Some(creator_code_icon_url(&code));
            }
        }
    }

    Ok(SelectedIconDto { url, plus })
}

async fn active_creator_code_value(
    cosmetic_api: &CosmeticApi,
    token: &str,
    is_experimental: bool,
) -> Option<Value> {
    let shop_user = cosmetic_api.get_shop_user(token, is_experimental).await.ok()?;
    shop_user.get("supportACreatorCode").cloned()
}

async fn creator_code_icon_unlocked(cosmetic_api: &CosmeticApi, code: &str) -> bool {
    cosmetic_api
        .get_creator_code_rewards(code)
        .await
        .ok()
        .and_then(|v| {
            v.get("rewards")
                .and_then(|r| r.get("creatorCodeIcon"))
                .and_then(|i| i.get("isUnlocked"))
                .and_then(|u| u.as_bool())
        })
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
    let cosmetic_api = CosmeticApi::new();
    let info = match active_creator_code_value(&cosmetic_api, &ctx.token, ctx.is_experimental).await
    {
        Some(v) => v,
        None => return Ok(None),
    };
    let code = match info.get("code").and_then(|c| c.as_str()) {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => return Ok(None),
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let is_valid = info
        .get("addTimestamp")
        .and_then(|t| t.as_u64())
        .map(|ts| now_ms.saturating_sub(ts) < CREATOR_CODE_VALID_MS)
        .unwrap_or(false);
    let has_valid_icon = info
        .get("hasValidIcon")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

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

#[derive(Serialize)]
pub struct EquippedCosmeticsDto {
    pub cosmetics: Vec<ResolvedCosmeticDto>,
    #[serde(rename = "customCapeHash")]
    pub custom_cape_hash: Option<String>,
}

#[tauri::command]
pub async fn get_equipped_cosmetics(
    player_identifier: String,
) -> Result<EquippedCosmeticsDto, CommandError> {
    let ctx = account_ctx(None).await?;
    let uuid = MinecraftApiService::new()
        .resolve_uuid(&player_identifier)
        .await?;

    let real_value = CosmeticApi::new()
        .get_player_outfit(&ctx.token, &uuid, ctx.is_experimental)
        .await
        .map_err(CommandError::from)?;
    let real: CosmeticRealOutfit = serde_json::from_value(real_value).unwrap_or_default();

    let settings_by_id = &real.outfit.cosmetic_settings;
    let custom_cape_hash = real.outfit.custom_cape_hash.clone();

    let all_equipped: Vec<String> = settings_by_id
        .keys()
        .filter(|id| id.as_str() != ZERO_UUID)
        .cloned()
        .collect();
    let owned_equipped: Vec<String> = all_equipped
        .iter()
        .filter(|id| real.owned_cosmetics.contains(id))
        .cloned()
        .collect();
    let cosmetic_ids = if !owned_equipped.is_empty() {
        owned_equipped
    } else {
        all_equipped
    };

    if cosmetic_ids.is_empty() {
        return Ok(EquippedCosmeticsDto {
            cosmetics: vec![],
            custom_cape_hash,
        });
    }

    let state = State::get().await?;
    let pack = state
        .cosmetic_pack_manager
        .get_or_load(PACK_ID)
        .await
        .map_err(CommandError::from)?;

    let mut cosmetics: Vec<ResolvedCosmeticDto> = Vec::new();
    for id in &cosmetic_ids {
        let settings = settings_by_id.get(id);
        if let Some(mut dto) = api_resolve_pack_cosmetic(&pack, id, settings).await {
            apply_custom_texture(&mut dto.urls, settings).await;
            cosmetics.push(dto);
        }
    }

    Ok(EquippedCosmeticsDto {
        cosmetics,
        custom_cape_hash,
    })
}

async fn apply_custom_texture(urls: &mut CosmeticAssetUrlsDto, settings: Option<&CosmeticSettings>) {
    if let Some(url) = resolve_custom_skin_url(settings).await {
        urls.texture = url;
    }
}

async fn resolve_custom_skin_url(settings: Option<&CosmeticSettings>) -> Option<String> {
    match settings?.custom_texture.as_ref()? {
        CustomTextureSource::PlayerName { name } => skin_url_for_player_name(name).await,
        CustomTextureSource::Url { url } => {
            if url.is_empty() {
                None
            } else {
                Some(url.clone())
            }
        }
        CustomTextureSource::Base64 { data } => {
            if data.is_empty() {
                None
            } else if data.starts_with("data:") {
                Some(data.clone())
            } else {
                Some(format!("data:image/png;base64,{}", data))
            }
        }
        CustomTextureSource::FileHash { .. } => None,
    }
}

async fn skin_url_for_player_name(name: &str) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    let profile = MinecraftApiService::new()
        .get_profile_by_name_or_uuid(name)
        .await
        .ok()?;
    let textures_prop = profile.properties.iter().find(|p| p.name == "textures")?;
    let decoded = base64::decode(&textures_prop.value).ok()?;
    let textures: TexturesData = serde_json::from_slice(&decoded).ok()?;
    let url = textures.textures.SKIN?.url;
    Some(if let Some(stripped) = url.strip_prefix("http:") {
        format!("https:{}", stripped)
    } else {
        url
    })
}
