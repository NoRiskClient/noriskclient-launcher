use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkPointsBalance {
    pub afk_points: i64,
    pub streak_days: i64,
    #[serde(default)]
    pub streak_freezes: i64,
    #[serde(default)]
    pub ads_remaining_today: Option<i64>,
    #[serde(default)]
    pub daily_claimable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyClaimState {
    pub claimable: bool,
    #[serde(default)]
    pub already_claimed: bool,
    #[serde(default)]
    pub ad_watched_today: bool,
    pub streak_days: i64,
    pub bonus: i64,
    pub milestone_bonus: i64,
    pub streak_freezes: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyClaimResult {
    pub granted: bool,
    pub streak_days: i64,
    pub bonus: i64,
    pub milestone_bonus: i64,
    pub balance: i64,
    #[serde(default)]
    pub frozen_days: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkShopItem {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    pub price: i64,
    #[serde(default)]
    pub rarity: String,
    pub category: String,
    pub grant: serde_json::Value,
    #[serde(default)]
    pub max_owned: Option<i64>,
    #[serde(default)]
    pub badge: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkShopCatalog {
    #[serde(default)]
    pub featured: Option<AfkShopItem>,
    #[serde(default)]
    pub featured_ends_at: Option<i64>,
    #[serde(default)]
    pub items: Vec<AfkShopItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkShopCatalogResponse {
    pub afk_points: i64,
    pub catalog: AfkShopCatalog,
    #[serde(default)]
    pub owned_counts: HashMap<String, i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkShopPurchaseRequest {
    pub item_id: String,
    pub purchase_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkShopPurchaseResponse {
    pub item_id: String,
    pub balance: i64,
    pub granted: String,
}
