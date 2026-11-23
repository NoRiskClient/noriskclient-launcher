use crate::error::CommandError;
use crate::feature_flags::{self, FeatureFlags};

#[tauri::command]
pub async fn get_feature_flags() -> Result<FeatureFlags, CommandError> {
    Ok(feature_flags::current().await.as_ref().clone())
}
