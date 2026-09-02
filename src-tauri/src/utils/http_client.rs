use log::{debug, error};
use reqwest::{IntoUrl, RequestBuilder};
use serde::{de::DeserializeOwned, Serialize};
use std::time::{Duration, Instant};

use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use crate::utils::api_utils;

const NRC_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Fluent wrapper over [`reqwest::RequestBuilder`] for the NoRisk backend lane:
/// build → header/query/body → send → uniform `AppError::RequestError` mapping →
/// one of the shared response terminals in [`api_utils`]. Request-side only; the
/// terminals delegate verbatim to `api_utils` (status-check, structured-error
/// translation, sensitive-data masking live there).
pub struct NrcRequest {
    builder: RequestBuilder,
}

pub fn nrc_get(url: impl IntoUrl) -> NrcRequest {
    NrcRequest::new(HTTP_CLIENT.get(url))
}

pub fn nrc_post(url: impl IntoUrl) -> NrcRequest {
    NrcRequest::new(HTTP_CLIENT.post(url))
}

pub fn nrc_put(url: impl IntoUrl) -> NrcRequest {
    NrcRequest::new(HTTP_CLIENT.put(url))
}

pub fn nrc_delete(url: impl IntoUrl) -> NrcRequest {
    NrcRequest::new(HTTP_CLIENT.delete(url))
}

impl NrcRequest {
    fn new(builder: RequestBuilder) -> Self {
        Self {
            builder: builder.timeout(NRC_REQUEST_TIMEOUT),
        }
    }

    pub fn bearer(mut self, token: &str) -> Self {
        self.builder = self
            .builder
            .header("Authorization", format!("Bearer {}", token));
        self
    }

    pub fn query<T: Serialize + ?Sized>(mut self, q: &T) -> Self {
        self.builder = self.builder.query(q);
        self
    }

    pub fn json_body<T: Serialize + ?Sized>(mut self, body: &T) -> Self {
        self.builder = self.builder.json(body);
        self
    }

    pub fn body(mut self, body: impl Into<reqwest::Body>) -> Self {
        self.builder = self.builder.body(body);
        self
    }

    /// Send the request, mapping transport failures to `AppError::RequestError`.
    /// The single place that error is built for this lane.
    async fn send_inner(self, ctx: &str) -> Result<reqwest::Response> {
        let target = self
            .builder
            .try_clone()
            .and_then(|b| b.build().ok())
            .map(|req| format!("{} {}", req.method(), req.url().path()));
        let started = Instant::now();
        let response = self.builder.send().await.map_err(|e| {
            error!("[HTTP] {} request failed: {}", ctx, e);
            AppError::RequestError(format!("Failed to send {} request: {}", ctx, e))
        })?;
        debug!(
            "[HTTP] {} -> {} ({}ms, {})",
            target.as_deref().unwrap_or("request"),
            response.status().as_u16(),
            started.elapsed().as_millis(),
            ctx
        );
        Ok(response)
    }

    pub async fn json<T: DeserializeOwned>(self, ctx: &str) -> Result<T> {
        let response = self.send_inner(ctx).await?;
        api_utils::parse_response_with_logging::<T>(response, ctx).await
    }

    pub async fn text(self, ctx: &str) -> Result<String> {
        let response = self.send_inner(ctx).await?;
        api_utils::parse_text_response_with_logging(response, ctx).await
    }

    pub async fn expect_success(self, ctx: &str) -> Result<()> {
        let response = self.send_inner(ctx).await?;
        api_utils::expect_success_with_logging(response, ctx).await
    }

    /// Escape hatch: send + uniform error mapping only. The caller owns the
    /// `reqwest::Response` for bespoke handling (`.bytes()`, parse-on-error,
    /// custom status logic).
    pub async fn send(self, ctx: &str) -> Result<reqwest::Response> {
        self.send_inner(ctx).await
    }
}
