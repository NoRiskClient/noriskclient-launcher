use crate::commands::request_context::account_ctx;
use crate::error::CommandError;
use crate::minecraft::api::cosmetic_api::CosmeticApi;
use crate::minecraft::api::cosmetic_pack_api::{
    local_emote_slugs, resolve_pack_cosmetic as api_resolve_pack_cosmetic,
    resolve_pack_emote as api_resolve_pack_emote, CosmeticAssetUrlsDto, EmoteAssetUrlsDto,
    ResolvedCosmeticDto,
};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::dto::cosmetic_outfit::{
    CosmeticRealOutfit, CosmeticSettings, CustomTextureSource,
};
use crate::state::state_manager::State;
use rand::seq::SliceRandom;
use serde::Serialize;

const PACK_ID: &str = "norisk-prod";
const ZERO_UUID: &str = "00000000-0000-0000-0000-000000000000";

#[tauri::command]
pub async fn get_random_local_emote() -> Result<Option<EmoteAssetUrlsDto>, CommandError> {
    let state = State::get().await?;
    let pack = state
        .cosmetic_pack_manager
        .get_or_load(PACK_ID)
        .await
        .map_err(CommandError::from)?;

    let slug = match local_emote_slugs(PACK_ID, &pack).choose(&mut rand::thread_rng()) {
        Some(s) => s.clone(),
        None => return Ok(None),
    };
    Ok(api_resolve_pack_emote(PACK_ID, &pack, &slug))
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

    let cosmetic_ids: Vec<String> = settings_by_id
        .keys()
        .filter(|id| id.as_str() != ZERO_UUID && real.owned_cosmetics.contains(id))
        .cloned()
        .collect();

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
        if let Some(mut dto) = api_resolve_pack_cosmetic(PACK_ID, &pack, id, settings).await {
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
    if settings.and_then(|s| s.selected_texture.as_ref()).is_some() {
        return;
    }
    if let Some(url) = resolve_custom_skin_url(settings).await {
        urls.texture = url;
    }
}

async fn resolve_custom_skin_url(settings: Option<&CosmeticSettings>) -> Option<String> {
    match settings?.custom_texture.as_ref()? {
        CustomTextureSource::PlayerName { name } => {
            MinecraftApiService::new().skin_url_by_name(name).await
        }
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
        CustomTextureSource::FileHash { hash } => Some(format!(
            "https://cdn.norisk.gg/cosmetic-textures/prod/{}.png",
            hash.to_lowercase()
        )),
    }
}
