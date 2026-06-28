use crate::error::{AppError, Result};
use log::{debug, error, info};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MCLOGS_API_URL: &str = "https://api.mclo.gs/1/log";
const REQUEST_TIMEOUT_SECONDS: u64 = 30;

// Static HTTP Client using once_cell
static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .expect("Failed to build static HTTP client") // Should not fail in practice
});

/// Represents the successful result from uploading a log to mclo.gs.
/// Note: `raw` URL is often the same as `url` but without syntax highlighting hints.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MclogsUploadResult {
    pub success: bool,
    pub id: String,
    pub url: String,
}

// Internal struct to deserialize the raw API response
#[derive(Deserialize, Debug)]
struct MclogsApiResponse {
    success: bool,
    url: Option<String>,
    id: Option<String>,
    error: Option<String>,
}

/// Uploads the given log content to mclo.gs and returns the structured result.
pub async fn upload_log_to_mclogs(log_content: String) -> Result<MclogsUploadResult> {
    info!(
        "Attempting to upload log to mclo.gs ({} bytes)",
        log_content.len()
    );

    // Validate content before sending
    if log_content.trim().is_empty() {
        return Err(AppError::MclogsUploadFailed(
            "Cannot upload empty log content".to_string(),
        ));
    }

    // Create the form data payload
    let params = [("content", log_content)];

    let response = HTTP_CLIENT
        .post(MCLOGS_API_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            error!("Network error during mclo.gs upload: {}", e);
            AppError::MclogsUploadFailed(format!("Network request failed: {}", e))
        })?;

    let status = response.status();

    // Parse the JSON response first to get any error messages
    match response.json::<MclogsApiResponse>().await {
        Ok(data) => {
            debug!("Received mclo.gs API response: {:?}", data);

            // Check for HTTP error status with API error message
            if !status.is_success() {
                let error_msg = data
                    .error
                    .unwrap_or_else(|| format!("HTTP Error: {}", status));
                error!("mclo.gs upload failed with status {}: {}", status, error_msg);
                return Err(AppError::MclogsUploadFailed(error_msg));
            }

            if data.success {
                // Match on references to avoid moving Option<String>
                match (&data.url, &data.id) {
                    (Some(url), Some(id)) => {
                        info!("Successfully uploaded log to: {}", url);
                        Ok(MclogsUploadResult {
                            success: true,
                            id: id.clone(),   // Clone the String from the reference
                            url: url.clone(), // Clone the String from the reference
                        })
                    }
                    _ => {
                        // Now it's safe to borrow data here as it wasn't moved
                        error!(
                            "mclo.gs API reported success but missing url or id. Response: {:?}",
                            data
                        );
                        Err(AppError::MclogsUploadFailed(
                            "API success but missing URL or ID".to_string(),
                        ))
                    }
                }
            } else {
                let error_msg = data
                    .error
                    .unwrap_or_else(|| "Unknown API error".to_string());
                error!("mclo.gs API reported failure: {}", error_msg);
                Err(AppError::MclogsUploadFailed(error_msg))
            }
        }
        Err(e) => {
            // JSON parsing failed - could be non-JSON error response
            if !status.is_success() {
                error!("mclo.gs upload failed with HTTP status: {}", status);
                Err(AppError::MclogsUploadFailed(format!("HTTP Error: {}", status)))
            } else {
                error!("Failed to parse JSON response from mclo.gs: {}", e);
                Err(AppError::MclogsUploadFailed(format!(
                    "Failed to parse response: {}",
                    e
                )))
            }
        }
    }
}
