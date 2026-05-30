use log::{debug, error};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::error::AppError;
use crate::utils::string_utils::safe_truncate;

/// Structured error body returned by the NoRisk backend:
/// `{"translatableKey": "...", "args": [...]}`.
#[derive(Deserialize)]
struct BackendApiError {
    #[serde(rename = "translatableKey")]
    translatable_key: String,
    #[serde(default)]
    args: Vec<String>,
}

/// Turn an already-read backend error body into an [`AppError`].
///
/// When the body is a structured `{translatableKey, args}` response it becomes
/// [`AppError::ApiError`] so the frontend can translate it; otherwise it falls
/// back to a plain [`AppError::RequestError`] carrying status + raw body.
pub fn api_error_from_body(status: reqwest::StatusCode, error_body: String) -> AppError {
    if let Ok(api_err) = serde_json::from_str::<BackendApiError>(error_body.trim()) {
        return AppError::ApiError {
            status: status.as_u16(),
            translatable_key: api_err.translatable_key,
            args: api_err.args,
        };
    }
    AppError::RequestError(format!(
        "Request failed with status {}: {}",
        status, error_body
    ))
}

/// Read an error response body and turn it into an [`AppError`] via
/// [`api_error_from_body`]. Use in `!status.is_success()` branches where the
/// body has not been read yet (consumes `response`).
pub async fn api_error_from_response(response: reqwest::Response, context: &str) -> AppError {
    let status = response.status();
    let error_body = response
        .text()
        .await
        .unwrap_or_else(|_| "Failed to read error body".to_string());
    error!("[API Utils] {} error response: {} - {}", context, status, error_body);
    api_error_from_body(status, error_body)
}

/// Read an HTTP response body as text, with status-check + logging.
///
/// On non-2xx returns a structured [`AppError`] (translatable when the backend
/// sent `{translatableKey, args}`). On success logs the body (first 1000 chars,
/// UTF-8-safe) and returns it. This is the shared base for
/// [`parse_response_with_logging`] (JSON) and the unit/text helpers.
pub async fn parse_text_response_with_logging(
    response: reqwest::Response,
    context: &str,
) -> Result<String, AppError> {
    let status = response.status();
    debug!("[API Utils] {} response status: {}", context, status);

    if !status.is_success() {
        return Err(api_error_from_response(response, context).await);
    }

    let response_text = response.text().await.map_err(|e| {
        error!("[API Utils] Failed to read {} response text: {}", context, e);
        AppError::ParseError(format!("Failed to read {} response: {}", context, e))
    })?;

    debug!(
        "[API Utils] {} response (first 1000 chars): {}",
        context,
        if response_text.len() > 1000 {
            format!("{}...", safe_truncate(&response_text, 1000))
        } else {
            response_text.clone()
        }
    );

    Ok(response_text)
}

/// Parse an HTTP response body as JSON, with status-check + logging.
///
/// On non-2xx returns a structured [`AppError`] (translatable when the backend
/// sent `{translatableKey, args}`); on parse failure includes the full body.
pub async fn parse_response_with_logging<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, AppError> {
    let response_text = parse_text_response_with_logging(response, context).await?;

    serde_json::from_str::<T>(&response_text).map_err(|e| {
        error!("[API Utils] Failed to parse {} response: {}", context, e);
        error!("[API Utils] Full {} response body: {}", context, response_text);
        AppError::ParseError(format!(
            "Failed to parse {}: {}. Response: {}",
            context, e, response_text
        ))
    })
}

/// Check an HTTP response status with logging, ignoring the success body.
///
/// On non-2xx returns a structured [`AppError`]; on 2xx returns `Ok(())`.
/// Use for endpoints that return no meaningful body (equip/delete/mark-read).
pub async fn expect_success_with_logging(
    response: reqwest::Response,
    context: &str,
) -> Result<(), AppError> {
    let status = response.status();
    debug!("[API Utils] {} response status: {}", context, status);

    if !status.is_success() {
        return Err(api_error_from_response(response, context).await);
    }

    Ok(())
}
