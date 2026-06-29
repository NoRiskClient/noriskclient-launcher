use serde::Deserialize;

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomIconInfo {
    pub current_icon: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SupportACreatorCode {
    pub code: Option<String>,
    pub add_timestamp: Option<u64>,
    pub has_valid_icon: bool,
}

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct CreatorCodeRewards {
    pub rewards: CreatorCodeRewardsInner,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct CreatorCodeRewardsInner {
    pub creator_code_icon: Unlockable,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Unlockable {
    pub is_unlocked: bool,
}
