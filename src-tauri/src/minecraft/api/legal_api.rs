use crate::{error::Result, utils::http_client::nrc_get};
use serde::Deserialize;
use std::time::Duration;

const LEGAL_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalDocumentUpdate {
    pub slug: String,
    pub locale: String,
    pub title: String,
    pub version: u32,
    pub updated_at: i64,
    pub change_summary: Option<String>,
    pub acknowledgement_version: Option<u32>,
    pub acknowledgement_updated_at: Option<i64>,
}

pub struct LegalApi;

impl LegalApi {
    fn get_api_base(is_experimental: bool) -> &'static str {
        if is_experimental {
            "https://api-staging.norisk.gg/api/v1/payback/legal"
        } else {
            "https://api.norisk.gg/api/v1/payback/legal"
        }
    }

    pub async fn get_updates(is_experimental: bool) -> Result<Vec<LegalDocumentUpdate>> {
        let url = format!("{}/updates", Self::get_api_base(is_experimental));
        nrc_get(&url)
            .timeout(LEGAL_REQUEST_TIMEOUT)
            .json::<Vec<LegalDocumentUpdate>>("Legal document updates")
            .await
    }
}
