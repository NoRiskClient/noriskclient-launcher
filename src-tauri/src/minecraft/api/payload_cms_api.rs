use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct PayloadCmsApi;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NeedsTestingResponse {
    pub docs: Vec<Value>,
    #[serde(rename = "totalDocs")]
    pub total_docs: i64,
}

#[derive(Serialize, Debug)]
pub struct SubmitTestVoteRequest {
    #[serde(rename = "issueId")]
    pub issue_id: String,
    pub uuid: String,
    pub kind: String,
    pub vote: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct SubmitTestVoteResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub doc: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

impl PayloadCmsApi {
    pub fn get_cms_base(is_experimental: bool) -> String {
        if is_experimental {
            debug!("[Payload CMS] Using experimental CMS endpoint");
            String::from("https://cms-staging.norisk.gg")
        } else {
            debug!("[Payload CMS] Using production CMS endpoint");
            String::from("https://cms.norisk.gg")
        }
    }

    pub async fn fetch_needs_testing(
        uuid: &str,
        token: &str,
        is_experimental: bool,
    ) -> Result<NeedsTestingResponse> {
        let base = Self::get_cms_base(is_experimental);
        let url = format!("{}/api/issues/needs-testing", base);

        debug!("[Payload CMS] Fetching needs-testing for uuid={}", uuid);

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .query(&[("uuid", uuid)])
            .send()
            .await
            .map_err(|e| {
                error!("[Payload CMS] needs-testing request failed: {}", e);
                AppError::RequestError(format!("Payload CMS needs-testing request failed: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(AppError::RequestError(format!(
                "Payload CMS needs-testing returned {}: {}",
                status, body
            )));
        }

        response.json::<NeedsTestingResponse>().await.map_err(|e| {
            error!("[Payload CMS] Failed to parse needs-testing response: {}", e);
            AppError::ParseError(format!(
                "Failed to parse Payload CMS needs-testing response: {}",
                e
            ))
        })
    }

    pub async fn submit_test_vote(
        body: SubmitTestVoteRequest,
        token: &str,
        is_experimental: bool,
    ) -> Result<SubmitTestVoteResponse> {
        let base = Self::get_cms_base(is_experimental);
        let url = format!("{}/api/issues/submit-test-vote", base);

        info!(
            "[Payload CMS] Submitting test vote: kind={} vote={} issue={}",
            body.kind, body.vote, body.issue_id
        );

        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                error!("[Payload CMS] submit-test-vote request failed: {}", e);
                AppError::RequestError(format!(
                    "Payload CMS submit-test-vote request failed: {}",
                    e
                ))
            })?;

        let status = response.status();
        // Payload error responses are `{error: "..."}` without ok/kind — fall
        // back so we don't lose the message on strict deserialize.
        let body_text = response.text().await.unwrap_or_default();
        let parsed: SubmitTestVoteResponse = serde_json::from_str(&body_text)
            .unwrap_or_else(|_| SubmitTestVoteResponse {
                ok: false,
                error: Some(body_text.clone()),
                ..Default::default()
            });

        if !status.is_success() || !parsed.ok {
            return Err(AppError::RequestError(format!(
                "Payload CMS submit-test-vote returned {}: {}",
                status,
                parsed
                    .error
                    .clone()
                    .filter(|e| !e.is_empty())
                    .unwrap_or_else(|| body_text.clone())
            )));
        }
        Ok(parsed)
    }
}
