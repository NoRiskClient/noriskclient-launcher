use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfkPointsBalance {
    pub afk_points: i64,
    pub streak_days: i64,
}
