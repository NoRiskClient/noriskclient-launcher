use crate::minecraft::dto::cosmetic_icon::{CustomIconInfo, SupportACreatorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoRiskUserMinimal {
    pub uuid: Uuid,
    pub ign: String,
    #[serde(default, rename = "lastSeen")]
    pub last_seen: Option<String>,
    #[serde(default, rename = "discordId")]
    pub discord_id: Option<String>,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default, rename = "noRiskPlusExpirationDate")]
    pub no_risk_plus_expiration_date: Option<i64>,
    #[serde(default, rename = "nameTag")]
    pub name_tag: Option<serde_json::Value>,
    #[serde(default, rename = "loginStreak")]
    pub login_streak: Option<serde_json::Value>,
    #[serde(default, rename = "customIconInfo")]
    pub custom_icon_info: CustomIconInfo,
    #[serde(default, rename = "supportACreatorCode")]
    pub support_a_creator_code: Option<SupportACreatorCode>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl NoRiskUserMinimal {
    pub fn is_norisk_plus(&self) -> bool {
        match self.no_risk_plus_expiration_date {
            Some(exp) => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                exp > now
            }
            None => false,
        }
    }
}
