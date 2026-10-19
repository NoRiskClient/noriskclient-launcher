use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::support::error::{SupportError, SupportResult};
use crate::support::types::{RemoteSupportRequest, SubmitResponse, SubmitResults};
use crate::utils::http_client::{nrc_get, nrc_post, NrcRequest};
use crate::utils::security_utils::mask_sensitive_data;
use crate::utils::string_utils::safe_truncate;
use log::{debug, warn};
use reqwest::multipart::{Form, Part};
use serde::de::DeserializeOwned;
use std::time::Duration;

const UPLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const LOGGED_ERROR_BODY_BYTES: usize = 300;

pub struct UploadFile {
    pub part_name: String,
    pub gzip_bytes: Vec<u8>,
}

fn endpoint(is_experimental: bool, code: &str, suffix: &str) -> String {
    format!(
        "{}/support/user/support-requests/{}{}",
        NoRiskApi::get_api_base(is_experimental),
        code,
        suffix
    )
}

async fn send(request: NrcRequest, token: &str, ctx: &str) -> SupportResult<reqwest::Response> {
    let response = request.bearer(token).log_as(ctx).send(ctx).await?;
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let body = response.text().await.unwrap_or_default();
    warn!(
        "[Support] Backend answered {}: {}",
        status,
        mask_sensitive_data(safe_truncate(&body, LOGGED_ERROR_BODY_BYTES))
    );
    Err(SupportError::from_response(status, &body, retry_after))
}

async fn read_json<T: DeserializeOwned>(response: reqwest::Response) -> SupportResult<T> {
    let text = response
        .text()
        .await
        .map_err(|e| SupportError::unknown(format!("cannot read response: {}", e)))?;
    serde_json::from_str(&text).map_err(|e| SupportError::unknown(format!("invalid response: {}", e)))
}

fn part(bytes: Vec<u8>, mime: &str) -> SupportResult<Part> {
    Part::bytes(bytes)
        .mime_str(mime)
        .map_err(|e| SupportError::unknown(e.to_string()))
}

pub async fn fetch(
    token: &str,
    code: &str,
    is_experimental: bool,
) -> SupportResult<RemoteSupportRequest> {
    let request = nrc_get(endpoint(is_experimental, code, ""));
    read_json(send(request, token, "Support request fetch").await?).await
}

pub async fn submit(
    token: &str,
    code: &str,
    is_experimental: bool,
    results: &SubmitResults,
    files: &[UploadFile],
) -> SupportResult<SubmitResponse> {
    let results_json = serde_json::to_vec(results)
        .map_err(|e| SupportError::unknown(format!("cannot encode results: {}", e)))?;
    let mut form = Form::new().part("results", part(results_json, "application/json")?);
    for file in files {
        debug!(
            "[Support] Attaching {} ({} bytes gzip)",
            file.part_name,
            file.gzip_bytes.len()
        );
        let gz = part(file.gzip_bytes.clone(), "application/gzip")?
            .file_name(format!("{}.gz", file.part_name));
        form = form.part(file.part_name.clone(), gz);
    }

    let request = nrc_post(endpoint(is_experimental, code, "/submit"))
        .timeout(UPLOAD_TIMEOUT)
        .multipart(form);
    read_json(send(request, token, "Support request submit").await?).await
}

pub async fn decline(token: &str, code: &str, is_experimental: bool) -> SupportResult<()> {
    let request = nrc_post(endpoint(is_experimental, code, "/decline"));
    send(request, token, "Support request decline").await?;
    Ok(())
}
