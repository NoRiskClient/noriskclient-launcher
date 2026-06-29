use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const PACK: &str = "norisk-prod";

fn index_url() -> String {
    format!("https://api.norisk.gg/api/v1/launcher/pack/{}", PACK)
}

fn cdn_base() -> String {
    format!("https://cdn.norisk.gg/assets/{}/assets/", PACK)
}

fn cdn_url(object_path: &str) -> String {
    format!("{}{}", cdn_base(), object_path)
}

#[derive(Debug, Clone)]
pub struct ParsedPack {
    pub by_uuid: HashMap<String, String>,
    pub paths: HashSet<String>,
}

pub async fn fetch_pack_index() -> Result<ParsedPack> {
    let response = HTTP_CLIENT.get(index_url()).send().await.map_err(|e| {
        AppError::RequestError(format!("Failed to fetch cosmetic pack index: {}", e))
    })?;

    let index: Value =
        crate::utils::api_utils::parse_response_with_logging(response, "Cosmetic pack index")
            .await?;

    let mut by_uuid = HashMap::new();
    let mut paths = HashSet::new();
    if let Some(objects) = index.get("objects").and_then(|o| o.as_object()) {
        for (path, obj) in objects {
            paths.insert(path.clone());
            if let Some(uuid) = obj.get("uuid").and_then(|u| u.as_str()) {
                by_uuid.insert(uuid.to_string(), path.clone());
            }
        }
    }
    Ok(ParsedPack { by_uuid, paths })
}

#[derive(Serialize, Debug)]
pub struct ParticleAssetDataDto {
    #[serde(rename = "jsonUrl")]
    pub json_url: String,
    pub dir: String,
    #[serde(rename = "particleFiles")]
    pub particle_files: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct CosmeticAssetUrlsDto {
    pub geo: String,
    pub texture: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animation: Option<String>,
    #[serde(rename = "metadataJson")]
    pub metadata_json: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcmeta: Option<String>,
    #[serde(rename = "particleData", skip_serializing_if = "Option::is_none")]
    pub particle_data: Option<Vec<ParticleAssetDataDto>>,
}

#[derive(Serialize, Debug)]
pub struct ResolvedCosmeticDto {
    #[serde(rename = "cosmeticId")]
    pub cosmetic_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub cosmetic_type: String,
    pub urls: CosmeticAssetUrlsDto,
}

#[derive(Serialize, Debug)]
pub struct EmoteAssetUrlsDto {
    pub animation: String,
    pub geo: String,
    pub texture: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcmeta: Option<String>,
}

fn merge_settings(mut meta: Value, settings: Option<&Value>) -> Value {
    let mut ds = meta
        .get("defaultSettings")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(s) = settings {
        if let Some(scale) = s.get("scale") {
            if !scale.is_null() {
                ds["scale"] = scale.clone();
            }
        }
        if let Some(offset) = s.get("offset") {
            if !offset.is_null() {
                ds["offset"] = offset.clone();
            }
        }
    }
    if let Some(obj) = meta.as_object_mut() {
        obj.insert("defaultSettings".to_string(), ds);
    }
    meta
}

fn particle_entries_for(dir: &str, paths: &HashSet<String>) -> Vec<ParticleAssetDataDto> {
    let particle_prefix = format!("{}particle/", dir);
    let mut entries = Vec::new();
    for p in paths {
        if p.len() > dir.len() && p.starts_with(dir) && p.ends_with(".particle.json") {
            let particle_files: Vec<String> = paths
                .iter()
                .filter_map(|q| q.strip_prefix(&particle_prefix))
                .filter(|name| !name.contains('/'))
                .map(|name| name.to_string())
                .collect();
            entries.push(ParticleAssetDataDto {
                json_url: cdn_url(p),
                dir: cdn_url(dir),
                particle_files,
            });
        }
    }
    entries
}

pub async fn resolve_pack_cosmetic(
    pack: &ParsedPack,
    cosmetic_id: &str,
    settings: Option<&Value>,
) -> Option<ResolvedCosmeticDto> {
    let meta_path = pack.by_uuid.get(cosmetic_id)?;

    let dir = &meta_path[..meta_path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let base = &meta_path[dir.len()..meta_path.len().saturating_sub(".norisk.json".len())];

    let geo_path = format!("{}{}.geo.json", dir, base);
    let anim_path = format!("{}{}.animation.json", dir, base);
    let tex_path = format!("{}{}.png", dir, base);
    let mcmeta_path = format!("{}{}.png.mcmeta", dir, base);

    let metadata_json = {
        let res = HTTP_CLIENT.get(cdn_url(meta_path)).send().await.ok()?;
        if !res.status().is_success() {
            return None;
        }
        let raw: Value = res.json().await.ok()?;
        merge_settings(raw, settings)
    };

    let cosmetic_type = metadata_json
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("HAT")
        .to_string();

    let has_geo = pack.paths.contains(&geo_path);
    if !has_geo && cosmetic_type.to_uppercase() != "CAPE" {
        return None;
    }
    if !pack.paths.contains(&tex_path) {
        return None;
    }

    let particles = particle_entries_for(dir, &pack.paths);
    let name = metadata_json
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();

    Some(ResolvedCosmeticDto {
        cosmetic_id: cosmetic_id.to_string(),
        name,
        cosmetic_type,
        urls: CosmeticAssetUrlsDto {
            geo: if has_geo { cdn_url(&geo_path) } else { String::new() },
            texture: cdn_url(&tex_path),
            animation: if pack.paths.contains(&anim_path) {
                Some(cdn_url(&anim_path))
            } else {
                None
            },
            metadata_json,
            mcmeta: if pack.paths.contains(&mcmeta_path) {
                Some(cdn_url(&mcmeta_path))
            } else {
                None
            },
            particle_data: if particles.is_empty() {
                None
            } else {
                Some(particles)
            },
        },
    })
}

pub fn resolve_pack_emote(pack: &ParsedPack, slug: &str) -> Option<EmoteAssetUrlsDto> {
    let suffix = format!("/emotes/{}.animation.json", slug);
    let nested_suffix = format!("/emotes/{}/{}.animation.json", slug, slug);

    let pick = pack
        .paths
        .iter()
        .find(|p| p.ends_with(&suffix) || p.ends_with(&nested_suffix))?
        .clone();

    let dir = &pick[..pick.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let base = &pick[dir.len()..pick.len().saturating_sub(".animation.json".len())];

    let geo_path = format!("{}{}.geo.json", dir, base);
    let tex_path = format!("{}{}.png", dir, base);
    let mcmeta_path = format!("{}{}.png.mcmeta", dir, base);

    Some(EmoteAssetUrlsDto {
        animation: cdn_url(&pick),
        geo: if pack.paths.contains(&geo_path) {
            cdn_url(&geo_path)
        } else {
            String::new()
        },
        texture: if pack.paths.contains(&tex_path) {
            cdn_url(&tex_path)
        } else {
            String::new()
        },
        mcmeta: if pack.paths.contains(&mcmeta_path) {
            Some(cdn_url(&mcmeta_path))
        } else {
            None
        },
    })
}
