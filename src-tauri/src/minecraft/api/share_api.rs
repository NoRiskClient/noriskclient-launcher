use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::utils::http_client::{nrc_get, nrc_post, nrc_put};

/// The presigned PUT has no total limit worth having for a 300 MB clip; stalls are caught by the caller.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
/// Completing runs ffprobe (and maybe a remux) on the server.
const COMPLETE_TIMEOUT: Duration = Duration::from_secs(3 * 60);
const LIMITS_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct MediaLimits {
    pub max_video_bytes: u64,
    #[serde(default)]
    pub max_text_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest<'a> {
    pub kind: &'a str,
    pub content_type: &'a str,
    pub size_bytes: i64,
    pub name: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadTicket {
    pub id: String,
    pub upload_url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Deserialize)]
pub struct Medium {
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareCreate<'a> {
    media: [&'a str; 1],
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expiry_days: Option<u32>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    permanent: bool,
}

/// What payback lets the signed-in player pick for how long a share stays up.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShareChoices {
    #[serde(default)]
    pub expiry_days: u32,
    #[serde(default)]
    pub expiry_choices: Vec<u32>,
    #[serde(default)]
    pub permanent_choice: bool,
    #[serde(default)]
    pub max_pinned: u32,
}

/// How long a share stays up, as the player picked; nothing picked is payback's default.
#[derive(Deserialize, Debug, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShareExpiry {
    #[serde(default)]
    pub days: Option<u32>,
    #[serde(default)]
    pub permanent: bool,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareDetails {
    pub title: Option<String>,
    pub expiry: ShareExpiry,
    pub hide_server: bool,
}

impl ShareDetails {
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref().map(str::trim).filter(|title| !title.is_empty())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub slug: String,
    pub page_url: String,
}

pub struct ShareApi;

impl ShareApi {
    fn media_base(is_experimental: bool) -> &'static str {
        if is_experimental {
            "https://ugc-staging.norisk.gg/api/v1/media"
        } else {
            "https://ugc.norisk.gg/api/v1/media"
        }
    }

    fn shares_url(is_experimental: bool) -> &'static str {
        if is_experimental {
            "https://api-staging.norisk.gg/api/v1/payback/shares"
        } else {
            "https://api.norisk.gg/api/v1/payback/shares"
        }
    }

    pub async fn limits(is_experimental: bool) -> Result<MediaLimits> {
        nrc_get(format!("{}/limits", Self::media_base(is_experimental)))
            .timeout(LIMITS_TIMEOUT)
            .json::<MediaLimits>("Media limits")
            .await
    }

    pub async fn start_upload(
        token: &str,
        is_experimental: bool,
        request: &UploadRequest<'_>,
    ) -> Result<UploadTicket> {
        nrc_post(format!("{}/uploads", Self::media_base(is_experimental)))
            .bearer(token)
            .json_body(request)
            .json::<UploadTicket>("Media upload ticket")
            .await
    }

    /// The presigned url carries its own signature: no Bearer token, exactly the headers it came with.
    pub async fn put_file(ticket: &UploadTicket, size: u64, body: reqwest::Body) -> Result<()> {
        let mut request = nrc_put(&ticket.upload_url)
            .timeout(UPLOAD_TIMEOUT)
            .log_as("PUT media upload");
        for (name, value) in &ticket.headers {
            if !name.eq_ignore_ascii_case("content-length") {
                request = request.header(name, value);
            }
        }
        request
            .header("Content-Length", size.to_string())
            .body(body)
            .expect_success("Media upload")
            .await
    }

    pub async fn complete_upload(token: &str, is_experimental: bool, id: &str) -> Result<Medium> {
        let url = format!(
            "{}/uploads/{}/complete",
            Self::media_base(is_experimental),
            urlencoding::encode(id)
        );
        nrc_post(url)
            .bearer(token)
            .timeout(COMPLETE_TIMEOUT)
            .json::<Medium>("Media upload complete")
            .await
    }

    /// The signed-in player's own choices; without the flag there are none.
    pub async fn choices(token: &str, is_experimental: bool) -> Result<ShareChoices> {
        nrc_get(format!("{}/limits", Self::shares_url(is_experimental)))
            .bearer(token)
            .timeout(LIMITS_TIMEOUT)
            .json::<ShareChoices>("Share limits")
            .await
    }

    pub async fn create_share(
        token: &str,
        is_experimental: bool,
        medium_id: &str,
        title: Option<&str>,
        server: Option<&str>,
        expiry: ShareExpiry,
    ) -> Result<Share> {
        nrc_post(Self::shares_url(is_experimental))
            .bearer(token)
            .json_body(&ShareCreate {
                media: [medium_id],
                title,
                server,
                expiry_days: expiry.days,
                permanent: expiry.permanent,
            })
            .json::<Share>("Media share")
            .await
    }
}
