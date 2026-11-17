use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Vector3f {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CosmeticFeatureSlot {
    Scalable,
    XAxis,
    YAxis,
    ZAxis,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CosmeticFeatureRange {
    pub start: f64,
    pub end_inclusive: f64,
}

impl CosmeticFeatureRange {
    pub fn contains(&self, value: f64) -> bool {
        value >= self.start && value <= self.end_inclusive
    }
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CosmeticFeature {
    pub range: CosmeticFeatureRange,
    #[serde(rename = "type", default)]
    pub kind: Option<CosmeticFeatureSlot>,
    #[serde(default)]
    pub additional_type: Option<CosmeticFeatureSlot>,
}

impl CosmeticFeature {
    pub fn slot(&self) -> Option<CosmeticFeatureSlot> {
        self.additional_type.or(self.kind)
    }
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default)]
pub struct CosmeticTransform {
    pub scale: f64,
    pub offset: Vector3f,
}

impl Default for CosmeticTransform {
    fn default() -> Self {
        Self {
            scale: 1.0,
            offset: Vector3f::default(),
        }
    }
}

impl CosmeticTransform {
    pub fn add(&mut self, slot: CosmeticFeatureSlot, value: f64) {
        match slot {
            CosmeticFeatureSlot::Scalable => self.scale += value,
            CosmeticFeatureSlot::XAxis => self.offset.x += value,
            CosmeticFeatureSlot::YAxis => self.offset.y += value,
            CosmeticFeatureSlot::ZAxis => self.offset.z += value,
        }
    }
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
    pub color: Option<Value>,
    pub custom_texture: Option<CustomTextureSource>,
    pub selected_texture: Option<String>,
}

impl CosmeticSettings {
    pub fn feature_value(&self, slot: CosmeticFeatureSlot) -> f64 {
        let offset = self.offset.unwrap_or_default();
        match slot {
            CosmeticFeatureSlot::Scalable => self.scale.unwrap_or(0.0),
            CosmeticFeatureSlot::XAxis => offset.x,
            CosmeticFeatureSlot::YAxis => offset.y,
            CosmeticFeatureSlot::ZAxis => offset.z,
        }
    }

    pub fn resolve_transform(
        &self,
        defaults: CosmeticTransform,
        features: &[CosmeticFeature],
    ) -> CosmeticTransform {
        let mut resolved = defaults;
        for feature in features {
            let Some(slot) = feature.slot() else { continue };
            let value = self.feature_value(slot);
            if feature.range.contains(value) {
                resolved.add(slot, value);
            }
        }
        resolved
    }
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
