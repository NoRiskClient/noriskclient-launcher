use serde::Deserialize;

use crate::error::{AppError, Result};
use crate::utils::http_client::nrc_post;

const MCLOGS_API_URL: &str = "https://api.mclo.gs/1/log";

#[derive(Deserialize)]
struct MclogsResponse {
    success: bool,
    url: Option<String>,
    error: Option<String>,
}

pub async fn upload_log(content: &str) -> Result<String> {
    let response: MclogsResponse = nrc_post(MCLOGS_API_URL)
        .form(&[("content", content)])
        .json("mclo.gs log upload")
        .await?;
    match response {
        MclogsResponse { success: true, url: Some(url), .. } => Ok(url),
        MclogsResponse { error, .. } => Err(AppError::RequestError(
            error.unwrap_or_else(|| "mclo.gs did not take the log".into()),
        )),
    }
}
