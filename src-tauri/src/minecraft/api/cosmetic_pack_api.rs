use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::utils::http_client::nrc_get;
use crate::minecraft::dto::cosmetic_outfit::{CosmeticFeature, CosmeticSettings, CosmeticTransform};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[cfg(test)]
#[path = "cosmetic_pack_api_test.rs"]
mod tests;

fn cdn_base(pack: &str) -> String {
    format!("https://cdn.norisk.gg/assets/{}/assets/", pack)
}

fn cdn_url(pack: &str, object_path: &str) -> String {
    format!("{}{}", cdn_base(pack), object_path)
}

fn noriskclient_dir() -> PathBuf {
    LAUNCHER_DIRECTORY
        .meta_dir()
        .join("assets")
        .join("noriskclient")
}

fn local_index_path(pack: &str) -> PathBuf {
    noriskclient_dir()
        .join("indexes")
        .join(format!("{}.json", pack))
}

pub fn local_object_path(pack: &str, hash: &str) -> Option<PathBuf> {
    if hash.len() < 2 {
        return None;
    }
    Some(
        noriskclient_dir()
            .join(pack)
            .join("objects")
            .join(&hash[..2])
            .join(hash),
    )
}

#[derive(Debug, Clone)]
pub struct ParsedPack {
    pub by_uuid: HashMap<String, String>,
    pub hash_by_path: HashMap<String, String>,
    pub paths: HashSet<String>,
}

fn parse_index(index: &Value) -> ParsedPack {
    let mut by_uuid = HashMap::new();
    let mut hash_by_path = HashMap::new();
    let mut paths = HashSet::new();
    if let Some(objects) = index.get("objects").and_then(|o| o.as_object()) {
        for (path, obj) in objects {
            paths.insert(path.clone());
            if let Some(hash) = obj.get("hash").and_then(|h| h.as_str()) {
                hash_by_path.insert(path.clone(), hash.to_string());
            }
            if let Some(uuid) = obj.get("uuid").and_then(|u| u.as_str()) {
                by_uuid.insert(uuid.to_string(), path.clone());
            }
        }
    }
    ParsedPack {
        by_uuid,
        hash_by_path,
        paths,
    }
}

/// Load the pack index local-first (from the downloaded asset cache), falling
/// back to the API when the local index is missing or unreadable.
pub async fn load_pack_index(pack: &str) -> Result<ParsedPack> {
    if let Ok(text) = tokio::fs::read_to_string(local_index_path(pack)).await {
        if let Ok(index) = serde_json::from_str::<Value>(&text) {
            return Ok(parse_index(&index));
        }
    }

    let url = format!("https://api.norisk.gg/api/v1/launcher/pack/{}", pack);
    let index: Value = nrc_get(url).json::<Value>("Cosmetic pack index").await?;
    Ok(parse_index(&index))
}

/// Resolve an object path to a usable asset reference: the local hashed object
/// file when present, otherwise the CDN URL. The TS layer turns non-`http`
/// values into asset URLs via `convertFileSrc`.
fn asset_ref(pack: &str, parsed: &ParsedPack, path: &str) -> String {
    if let Some(hash) = parsed.hash_by_path.get(path) {
        if let Some(local) = local_object_path(pack, hash) {
            if local.is_file() {
                return local.to_string_lossy().to_string();
            }
        }
    }
    cdn_url(pack, path)
}

async fn read_object_or_cdn(pack: &str, parsed: &ParsedPack, path: &str) -> Option<Value> {
    if let Some(hash) = parsed.hash_by_path.get(path) {
        if let Some(local) = local_object_path(pack, hash) {
            if local.is_file() {
                if let Ok(text) = tokio::fs::read_to_string(&local).await {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        return Some(v);
                    }
                }
            }
        }
    }
    let res = HTTP_CLIENT.get(cdn_url(pack, path)).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.json::<Value>().await.ok()
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

fn merge_settings(mut meta: Value, settings: Option<&CosmeticSettings>) -> Value {
    let Some(settings) = settings else {
        return meta;
    };

    let defaults: CosmeticTransform = meta
        .get("defaultSettings")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let features: Vec<CosmeticFeature> = meta
        .get("features")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    let resolved = settings.resolve_transform(defaults, &features);

    let target = meta
        .as_object_mut()
        .map(|obj| obj.entry("defaultSettings").or_insert_with(|| json!({})));
    if let Some(Value::Object(ds)) = target {
        ds.insert("scale".into(), json!(resolved.scale));
        ds.insert("offset".into(), json!(resolved.offset));
        if let Some(color) = &settings.color {
            ds.insert("color".into(), color.clone());
        }
    }
    meta
}

fn particle_entries_for(pack: &str, dir: &str, paths: &HashSet<String>) -> Vec<ParticleAssetDataDto> {
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
                json_url: cdn_url(pack, p),
                dir: cdn_url(pack, dir),
                particle_files,
            });
        }
    }
    entries
}

pub async fn resolve_pack_cosmetic(
    pack: &str,
    parsed: &ParsedPack,
    cosmetic_id: &str,
    settings: Option<&CosmeticSettings>,
) -> Option<ResolvedCosmeticDto> {
    let meta_path = parsed.by_uuid.get(cosmetic_id)?.clone();

    let dir = &meta_path[..meta_path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let base = &meta_path[dir.len()..meta_path.len().saturating_sub(".norisk.json".len())];

    let geo_path = format!("{}{}.geo.json", dir, base);
    let anim_path = format!("{}{}.animation.json", dir, base);
    let tex_path = format!("{}{}.png", dir, base);
    let mcmeta_path = format!("{}{}.png.mcmeta", dir, base);

    let raw = read_object_or_cdn(pack, parsed, &meta_path).await?;
    let metadata_json = merge_settings(raw, settings);

    let cosmetic_type = metadata_json
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("HAT")
        .to_string();

    let has_geo = parsed.paths.contains(&geo_path);
    if !has_geo && cosmetic_type.to_uppercase() != "CAPE" {
        return None;
    }
    if !parsed.paths.contains(&tex_path) {
        return None;
    }

    let texture_path = settings
        .and_then(|s| s.selected_texture.as_ref())
        .map(|sel| format!("{}textures/{}.png", dir, sel.to_lowercase()))
        .filter(|p| parsed.paths.contains(p))
        .unwrap_or_else(|| tex_path.clone());

    let particles = particle_entries_for(pack, dir, &parsed.paths);
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
            geo: if has_geo {
                asset_ref(pack, parsed, &geo_path)
            } else {
                String::new()
            },
            texture: asset_ref(pack, parsed, &texture_path),
            animation: if parsed.paths.contains(&anim_path) {
                Some(asset_ref(pack, parsed, &anim_path))
            } else {
                None
            },
            metadata_json,
            mcmeta: if parsed.paths.contains(&mcmeta_path) {
                Some(asset_ref(pack, parsed, &mcmeta_path))
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

fn is_local_object(pack: &str, parsed: &ParsedPack, path: &str) -> bool {
    parsed
        .hash_by_path
        .get(path)
        .and_then(|hash| local_object_path(pack, hash))
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// Slugs of emotes whose animation object is downloaded locally. Emote anims
/// live at `.../emotes/<slug>.animation.json` or the nested
/// `.../emotes/<slug>/<slug>.animation.json`.
pub fn local_emote_slugs(pack: &str, parsed: &ParsedPack) -> Vec<String> {
    let mut slugs = HashSet::new();
    for p in &parsed.paths {
        let Some(idx) = p.find("/emotes/") else {
            continue;
        };
        let after = &p[idx + "/emotes/".len()..];
        let Some(name) = after.strip_suffix(".animation.json") else {
            continue;
        };
        if is_local_object(pack, parsed, p) {
            let slug = name.split('/').next().unwrap_or(name);
            slugs.insert(slug.to_string());
        }
    }
    slugs.into_iter().collect()
}

pub fn resolve_pack_emote(pack: &str, parsed: &ParsedPack, slug: &str) -> Option<EmoteAssetUrlsDto> {
    let suffix = format!("/emotes/{}.animation.json", slug);
    let nested_suffix = format!("/emotes/{}/{}.animation.json", slug, slug);

    let pick = parsed
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
        animation: asset_ref(pack, parsed, &pick),
        geo: if parsed.paths.contains(&geo_path) {
            asset_ref(pack, parsed, &geo_path)
        } else {
            String::new()
        },
        texture: if parsed.paths.contains(&tex_path) {
            asset_ref(pack, parsed, &tex_path)
        } else {
            String::new()
        },
        mcmeta: if parsed.paths.contains(&mcmeta_path) {
            Some(asset_ref(pack, parsed, &mcmeta_path))
        } else {
            None
        },
    })
}
