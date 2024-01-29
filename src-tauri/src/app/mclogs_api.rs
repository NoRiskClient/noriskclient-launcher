use serde::{Deserialize, Serialize};
use crate::HTTP_CLIENT;

/// Placeholder struct for API endpoints implementation
pub struct McLogsApiEndpoints;

impl McLogsApiEndpoints {
    pub async fn upload_logs(log: String) -> anyhow::Result<McLogsUploadResponse> {
        println!("Uploading Logs...");
        let form = reqwest::multipart::Form::new().text("content", log);
        Ok(HTTP_CLIENT.post("https://api.mclo.gs/1/log")
            .multipart(form)
            .send().await?
            .error_for_status()?
            .json::<McLogsUploadResponse>()
            .await?)
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct McLogsUploadResponse {
    pub success: bool,
    pub id: String,
    pub url: String,
    pub raw: String,
}