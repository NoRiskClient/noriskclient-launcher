use log::{debug, error};
use serde::de::DeserializeOwned;

use crate::error::AppError;

/// Generic helper to parse an HTTP response with detailed error logging.
///
/// This function:
/// 1. Checks the response status
/// 2. Reads the response body as text
/// 3. Logs the response (first 1000 chars) for debugging
/// 4. Parses it as JSON
/// 5. On parse error, includes the full response body in the error message
///
/// # Arguments
/// * `response` - The reqwest Response to parse
/// * `context` - A descriptive name for logging (e.g., "Notifications", "AdventCalendar")
///
/// # Returns
/// * `Ok(T)` - The parsed response
/// * `Err(AppError)` - On HTTP error or parse failure (with full response in error)
pub async fn parse_response_with_logging<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, AppError> {
    let status = response.status();
    debug!("[API Utils] {} response status: {}", context, status);

    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        error!("[API Utils] {} error response: {}", context, error_body);
        return Err(AppError::RequestError(format!(
            "{} failed with status {}: {}",
            context, status, error_body
        )));
    }

    let response_text = response.text().await.map_err(|e| {
        error!("[API Utils] Failed to read {} response text: {}", context, e);
        AppError::ParseError(format!("Failed to read {} response: {}", context, e))
    })?;

    // Log first 1000 chars for debugging
    debug!(
        "[API Utils] {} response (first 1000 chars): {}",
        context,
        if response_text.len() > 1000 {
            format!("{}...", &response_text[..1000])
        } else {
            response_text.clone()
        }
    );

    serde_json::from_str::<T>(&response_text).map_err(|e| {
        error!("[API Utils] Failed to parse {} response: {}", context, e);
        error!("[API Utils] Full {} response body: {}", context, response_text);
        AppError::ParseError(format!(
            "Failed to parse {}: {}. Response: {}",
            context, e, response_text
        ))
    })
}
