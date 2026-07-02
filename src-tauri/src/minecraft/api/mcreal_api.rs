use crate::error::{AppError, Result};
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::utils::http_client::{nrc_delete, nrc_get, nrc_post};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Client for the McReal social API (`/api/v1/mcreal/...`).
///
/// All routes accept the NoRisk JWT as `Authorization: Bearer` plus the
/// player's `uuid` as query param (required for the mobile-token auth path,
/// harmless for JWT auth).
pub struct McRealApi;

// --- DTOs ---
// Backend uses kotlinx.serialization: ObjectId -> hex string under "_id",
// UUID/LocalDate/LocalTime -> strings. Dates/times stay strings here; the
// frontend formats them.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealPost {
    #[serde(rename = "_id")]
    pub id: String,
    pub author: String,
    pub upload_date: String,
    pub upload_time: String,
    pub mc_real_time: String,
    pub mc_real_date: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub server_ip: Option<String>,
    #[serde(default = "default_true")]
    pub friends_only: bool,
    #[serde(default)]
    pub media_types: HashMap<String, String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub upload_timestamp: i64,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealRating {
    pub user: String,
    #[serde(default = "default_true")]
    pub is_positive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealPostWithRating {
    pub post: McRealPost,
    #[serde(default)]
    pub likes: i32,
    #[serde(default)]
    pub dislikes: i32,
    #[serde(default)]
    pub user_rating: Option<McRealRating>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealComment {
    #[serde(rename = "_id")]
    pub id: String,
    pub post_id: String,
    pub author: String,
    pub text: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub parent_comment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealCommentWithRating {
    pub comment: McRealComment,
    #[serde(default)]
    pub replies: i64,
    #[serde(default)]
    pub likes: i32,
    #[serde(default)]
    pub dislikes: i32,
    #[serde(default)]
    pub user_rating: Option<McRealRating>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealCommentsHolder {
    #[serde(default)]
    pub single_total_comments: i64,
    #[serde(default)]
    pub total_comments: i64,
    #[serde(default)]
    pub comments: Vec<McRealCommentWithRating>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealUser {
    #[serde(rename = "_id")]
    pub uuid: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub pinned_posts: Vec<Option<String>>,
    #[serde(default)]
    pub total_post_of_the_days: i32,
    #[serde(default)]
    pub streak: serde_json::Value,
    #[serde(default)]
    pub post_of_the_day_streak: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealUserClient {
    pub user: McRealUser,
    #[serde(default)]
    pub posts_with_rating: Vec<McRealPostWithRating>,
    #[serde(default)]
    pub punishment: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McRealProfile {
    pub nrc_user: serde_json::Value,
    #[serde(default)]
    pub pinned_posts: Vec<Option<McRealPostWithRating>>,
    #[serde(default)]
    pub last_posts: Vec<Option<McRealPostWithRating>>,
    #[serde(default)]
    pub first_join_time_stamp: i64,
    #[serde(default)]
    pub last_join_time_stamp: i64,
    #[serde(default)]
    pub play_time: i64,
    #[serde(default)]
    pub login_streak: serde_json::Value,
    #[serde(default)]
    pub mc_real_streak: serde_json::Value,
}

impl McRealApi {
    fn base(is_experimental: bool) -> String {
        format!("{}/mcreal", NoRiskApi::get_api_base(is_experimental))
    }

    pub async fn get_posts(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        friends_only: bool,
        partners_only: bool,
        page: u32,
        sort: &str,
    ) -> Result<Vec<McRealPostWithRating>> {
        let url = format!("{}/posts", Self::base(is_experimental));
        debug!("[McReal API] Fetching feed page {} (friendsOnly={})", page, friends_only);

        nrc_get(url)
            .bearer(token)
            .query(&[
                ("uuid", uuid.to_string()),
                ("friendsOnly", friends_only.to_string()),
                ("partnersOnly", partners_only.to_string()),
                ("page", page.to_string()),
                ("sort", sort.to_string()),
            ])
            .json::<Vec<McRealPostWithRating>>("McReal feed")
            .await
    }

    /// Today's own post; None if nothing was posted yet.
    pub async fn get_today_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
    ) -> Result<Option<McRealPostWithRating>> {
        let url = format!("{}/post", Self::base(is_experimental));

        let response = nrc_get(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .send("McReal today post")
            .await?;

        if !response.status().is_success() {
            return Ok(None);
        }
        let text = response
            .text()
            .await
            .map_err(|e| AppError::Other(format!("McReal today post read failed: {}", e)))?;
        if text.trim().is_empty() || text.trim() == "null" {
            return Ok(None);
        }
        serde_json::from_str::<McRealPostWithRating>(&text)
            .map(Some)
            .map_err(|e| AppError::Other(format!("McReal today post parse failed: {}", e)))
    }

    pub async fn get_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
    ) -> Result<McRealPostWithRating> {
        let url = format!("{}/post/{}", Self::base(is_experimental), post_id);

        nrc_get(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .json::<McRealPostWithRating>("McReal post")
            .await
    }

    pub async fn delete_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
    ) -> Result<Vec<McRealPostWithRating>> {
        let url = format!("{}/post/{}", Self::base(is_experimental), post_id);

        nrc_delete(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .json::<Vec<McRealPostWithRating>>("McReal delete post")
            .await
    }

    /// Raw media bytes for a post slot (`primary` / `secondary`).
    /// Videos are served as their webp poster frame (supportsVideo=false).
    /// Second tuple element: true when the server delivered the blurred
    /// variant (viewer hasn't posted today — BeReal-style gating), signaled
    /// via "blurred" in the Content-Disposition header.
    pub async fn get_post_image(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
        image_type: &str,
    ) -> Result<(Vec<u8>, bool)> {
        // Post media is served by the assets service, not the main backend
        // (its /post/{id}/image route 404s in prod).
        let url = format!(
            "https://assets.norisk.gg/api/v1/assets/mcreal/post/{}/image",
            post_id
        );

        let response = nrc_get(url)
            .bearer(token)
            .query(&[
                ("uuid", uuid),
                ("type", image_type),
                ("experimental", if is_experimental { "true" } else { "false" }),
            ])
            .send("McReal post image")
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "McReal image request failed with status {}",
                response.status()
            )));
        }

        let blurred = response
            .headers()
            .get("content-disposition")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.contains("blurred"))
            .unwrap_or(false);

        response
            .bytes()
            .await
            .map(|b| (b.to_vec(), blurred))
            .map_err(|e| AppError::Other(format!("McReal image download failed: {}", e)))
    }

    pub async fn rate_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
        is_positive: bool,
    ) -> Result<McRealRating> {
        let url = format!("{}/post/rate", Self::base(is_experimental));

        nrc_post(url)
            .bearer(token)
            .query(&[
                ("uuid", uuid.to_string()),
                ("postId", post_id.to_string()),
                ("isPositive", is_positive.to_string()),
            ])
            .json::<McRealRating>("McReal rate post")
            .await
    }

    pub async fn unrate_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
    ) -> Result<()> {
        let url = format!("{}/post/rate", Self::base(is_experimental));

        nrc_delete(url)
            .bearer(token)
            .query(&[("uuid", uuid), ("postId", post_id)])
            .expect_success("McReal unrate post")
            .await
    }

    pub async fn get_comments(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
        page: u32,
        parent_comment_id: Option<&str>,
    ) -> Result<McRealCommentsHolder> {
        let url = format!("{}/comments", Self::base(is_experimental));

        let mut query: Vec<(&str, String)> = vec![
            ("uuid", uuid.to_string()),
            ("postId", post_id.to_string()),
            ("page", page.to_string()),
        ];
        if let Some(parent) = parent_comment_id {
            query.push(("parentCommentId", parent.to_string()));
        }

        nrc_get(url)
            .bearer(token)
            .query(&query)
            .json::<McRealCommentsHolder>("McReal comments")
            .await
    }

    pub async fn add_comment(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        post_id: &str,
        text: &str,
        parent_comment_id: Option<&str>,
    ) -> Result<McRealCommentWithRating> {
        let url = format!("{}/comments", Self::base(is_experimental));

        let mut query: Vec<(&str, String)> = vec![
            ("uuid", uuid.to_string()),
            ("postId", post_id.to_string()),
            ("text", text.to_string()),
        ];
        if let Some(parent) = parent_comment_id {
            query.push(("parentCommentId", parent.to_string()));
        }

        nrc_post(url)
            .bearer(token)
            .query(&query)
            .json::<McRealCommentWithRating>("McReal add comment")
            .await
    }

    pub async fn delete_comment(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        comment_id: &str,
    ) -> Result<()> {
        let url = format!("{}/comments", Self::base(is_experimental));

        nrc_delete(url)
            .bearer(token)
            .query(&[("uuid", uuid), ("commentId", comment_id)])
            .expect_success("McReal delete comment")
            .await
    }

    pub async fn rate_comment(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        comment_id: &str,
        is_positive: bool,
    ) -> Result<McRealRating> {
        let url = format!("{}/comments/rating", Self::base(is_experimental));

        nrc_post(url)
            .bearer(token)
            .query(&[
                ("uuid", uuid.to_string()),
                ("commentId", comment_id.to_string()),
                ("isPositive", is_positive.to_string()),
            ])
            .json::<McRealRating>("McReal rate comment")
            .await
    }

    pub async fn unrate_comment(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        comment_id: &str,
    ) -> Result<()> {
        let url = format!("{}/comments/rating", Self::base(is_experimental));

        nrc_delete(url)
            .bearer(token)
            .query(&[("uuid", uuid), ("commentId", comment_id)])
            .expect_success("McReal unrate comment")
            .await
    }

    /// Fetches (and lazily creates) the own McReal user. JWT-only route.
    pub async fn get_user(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        zone_id: Option<&str>,
    ) -> Result<McRealUserClient> {
        let url = format!("{}/user", Self::base(is_experimental));

        let mut query: Vec<(&str, String)> = vec![("uuid", uuid.to_string())];
        if let Some(zone) = zone_id {
            query.push(("zoneId", zone.to_string()));
        }

        nrc_get(url)
            .bearer(token)
            .query(&query)
            .json::<McRealUserClient>("McReal user")
            .await
    }

    pub async fn get_profile(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        target_user: &str,
    ) -> Result<McRealProfile> {
        let url = format!("{}/user/profile/{}", Self::base(is_experimental), target_user);

        nrc_get(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .json::<McRealProfile>("McReal profile")
            .await
    }

    pub async fn follow(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        target_user: &str,
    ) -> Result<()> {
        let url = format!("{}/user/follow/{}", Self::base(is_experimental), target_user);

        nrc_post(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .expect_success("McReal follow")
            .await
    }

    pub async fn unfollow(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        target_user: &str,
    ) -> Result<()> {
        let url = format!("{}/user/unfollow/{}", Self::base(is_experimental), target_user);

        nrc_delete(url)
            .bearer(token)
            .query(&[("uuid", uuid)])
            .expect_success("McReal unfollow")
            .await
    }

    /// Uploads a new post: multipart with exactly two parts named
    /// `primary` and `secondary` (webp/jpeg/png, max 10 MB each).
    pub async fn upload_post(
        token: &str,
        uuid: &str,
        is_experimental: bool,
        primary: Vec<u8>,
        primary_mime: &str,
        secondary: Vec<u8>,
        secondary_mime: &str,
        title: Option<&str>,
        friends_only: bool,
        server_ip: Option<&str>,
    ) -> Result<Vec<McRealPostWithRating>> {
        use crate::config::HTTP_CLIENT;

        let mut url = reqwest::Url::parse(&format!("{}/post", Self::base(is_experimental)))
            .map_err(|e| AppError::Other(format!("McReal upload URL invalid: {}", e)))?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("uuid", uuid);
            q.append_pair("friendsOnly", &friends_only.to_string());
            if let Some(t) = title {
                q.append_pair("title", t);
            }
            if let Some(ip) = server_ip {
                q.append_pair("serverIp", ip);
            }
        }

        info!("[McReal API] Uploading post ({} + {} bytes)", primary.len(), secondary.len());

        let form = reqwest::multipart::Form::new()
            .part(
                "primary",
                reqwest::multipart::Part::bytes(primary)
                    .file_name("primary")
                    .mime_str(primary_mime)
                    .map_err(|e| AppError::Other(format!("Invalid primary mime: {}", e)))?,
            )
            .part(
                "secondary",
                reqwest::multipart::Part::bytes(secondary)
                    .file_name("secondary")
                    .mime_str(secondary_mime)
                    .map_err(|e| AppError::Other(format!("Invalid secondary mime: {}", e)))?,
            );

        let response = HTTP_CLIENT
            .post(url)
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("McReal upload failed: {}", e)))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| AppError::Other(format!("McReal upload response read failed: {}", e)))?;

        if !status.is_success() {
            return Err(AppError::Other(format!(
                "McReal upload failed with status {}: {}",
                status, text
            )));
        }

        serde_json::from_str::<Vec<McRealPostWithRating>>(&text)
            .map_err(|e| AppError::Other(format!("McReal upload response parse failed: {}", e)))
    }
}
