use crate::commands::request_context::account_ctx;
use crate::error::CommandError;
use crate::minecraft::api::cosmetic_api::CosmeticApi;
use crate::minecraft::api::cosmetic_pack_api::{
    load_pack_index, local_emote_slugs, local_object_path,
    resolve_pack_cosmetic as api_resolve_pack_cosmetic,
    resolve_pack_emote as api_resolve_pack_emote, CosmeticAssetUrlsDto, EmoteAssetUrlsDto,
    ResolvedCosmeticDto,
};
use rand::seq::SliceRandom;
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::dto::cosmetic_outfit::{
    CosmeticRealOutfit, CosmeticSettings, CustomTextureSource,
};
use crate::state::state_manager::State;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const PACK_ID: &str = "norisk-prod";
const ZERO_UUID: &str = "00000000-0000-0000-0000-000000000000";

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
    Ok(api_resolve_pack_cosmetic(PACK_ID, &pack, &cosmetic_id, settings.as_ref()).await)
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
    Ok(api_resolve_pack_emote(PACK_ID, &pack, &slug))
}

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

#[derive(Deserialize, Debug)]
pub struct GetPlayerOutfitPayload {
    pub player_identifier: String,
    pub norisk_token: Option<String>,
}

#[tauri::command]
pub async fn get_player_outfit(
    payload: GetPlayerOutfitPayload,
) -> Result<Value, CommandError> {
    debug!("[CMD get_player_outfit] payload: {:?}", payload);

    let ctx = account_ctx(payload.norisk_token).await?;
    let player_uuid = MinecraftApiService::new()
        .resolve_uuid(&payload.player_identifier)
        .await?;

    CosmeticApi::new()
        .get_player_outfit(&ctx.token, &player_uuid, ctx.is_experimental)
        .await
        .map_err(|e| {
            error!("[CMD get_player_outfit] cosmetic_api error: {:?}", e);
            CommandError::from(e)
        })
}

#[tauri::command]
pub async fn get_player_icon(
    payload: GetPlayerOutfitPayload,
) -> Result<Value, CommandError> {
    let ctx = account_ctx(payload.norisk_token).await?;
    let player_uuid = MinecraftApiService::new()
        .resolve_uuid(&payload.player_identifier)
        .await?;

    CosmeticApi::new()
        .get_player_icon(&ctx.token, &player_uuid, ctx.is_experimental)
        .await
        .map_err(CommandError::from)
}

#[derive(Serialize, Debug)]
pub struct LocalCosmetic {
    pub id: String,
    pub cosmetic_type: String,
    pub slug: String,
    pub geo_path: Option<String>,
    pub animation_path: Option<String>,
    pub texture_path: Option<String>,
    pub mcmeta_path: Option<String>,
    pub metadata: Value,
}

#[tauri::command]
pub async fn get_local_cosmetics() -> Result<Vec<LocalCosmetic>, CommandError> {
    let parsed = load_pack_index(PACK_ID).await.map_err(CommandError::from)?;

    let object = |path: &str| -> Option<String> {
        let hash = parsed.hash_by_path.get(path)?;
        let p = local_object_path(PACK_ID, hash)?;
        p.is_file().then(|| p.to_string_lossy().to_string())
    };

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for path in &parsed.paths {
        if !path.ends_with(".norisk.json") {
            continue;
        }
        let meta_obj = match object(path) {
            Some(p) => p,
            None => continue,
        };
        let metadata: Value = match std::fs::read_to_string(&meta_obj)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(v) => v,
            None => continue,
        };
        let id = match metadata.get("id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if !seen.insert(id.clone()) {
            continue;
        }

        let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
        let base = &path[dir.len()..path.len() - ".norisk.json".len()];
        let cosmetic_type = metadata
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let slug = metadata
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or(base)
            .to_string();

        out.push(LocalCosmetic {
            id,
            cosmetic_type,
            slug,
            geo_path: object(&format!("{}{}.geo.json", dir, base)),
            animation_path: object(&format!("{}{}.animation.json", dir, base)),
            texture_path: object(&format!("{}{}.png", dir, base)),
            mcmeta_path: object(&format!("{}{}.png.mcmeta", dir, base)),
            metadata,
        });
    }

    debug!("[CMD get_local_cosmetics] found {} local cosmetics", out.len());
    Ok(out)
}

async fn apply_custom_texture(urls: &mut CosmeticAssetUrlsDto, settings: Option<&CosmeticSettings>) {
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
        CustomTextureSource::FileHash { .. } => None,
    }
}
