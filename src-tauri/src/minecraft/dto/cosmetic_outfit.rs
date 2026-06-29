use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize, Clone, Debug)]
pub struct Vector3f {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum CustomTextureSource {
    #[serde(rename = "playerName")]
    PlayerName { name: String },
    #[serde(rename = "url")]
    Url { url: String },
    #[serde(rename = "hash")]
    FileHash { hash: String },
    #[serde(rename = "base64")]
    Base64 { data: String },
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CosmeticSettings {
    pub scale: Option<f64>,
    pub offset: Option<Vector3f>,
    pub custom_texture: Option<CustomTextureSource>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CosmeticOutfit {
    pub cosmetic_settings: BTreeMap<String, CosmeticSettings>,
    pub custom_cape_hash: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CosmeticRealOutfit {
    pub outfit: CosmeticOutfit,
    pub owned_cosmetics: Vec<String>,
}
