use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomIconInfo {
    pub current_icon: Option<String>,
}

#[derive(Deserialize, Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct SupportACreatorCode {
    pub code: Option<String>,
    pub add_timestamp: Option<u64>,
    pub has_valid_icon: bool,
}
