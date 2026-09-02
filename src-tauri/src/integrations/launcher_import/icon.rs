use super::model::IconRef;
use crate::state::profile_state::{ImageSource, ProfileBanner};
use base64::Engine;
use log::debug;
use std::path::Path;

const MAX_ICON_BYTES: u64 = 256 * 1024;

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    }
}

impl IconRef {
    pub async fn as_image_source(&self) -> Option<ImageSource> {
        let path = match self {
            Self::Url(url) => return Some(ImageSource::Url { url: url.clone() }),
            Self::File(path) => path,
        };

        let metadata = tokio::fs::metadata(path).await.ok()?;
        if metadata.len() > MAX_ICON_BYTES {
            debug!("Instance icon '{}' is too large to preview", path.display());
            return None;
        }

        let bytes = tokio::fs::read(path).await.ok()?;

        Some(ImageSource::Base64 {
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            mime_type: Some(mime_for(path).to_string()),
        })
    }

    pub async fn store_in(&self, profile_dir: &Path) -> Option<ProfileBanner> {
        let path = match self {
            Self::Url(url) => {
                return Some(ProfileBanner {
                    source: ImageSource::Url { url: url.clone() },
                })
            }
            Self::File(path) => path,
        };

        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("png");
        let file_name = format!("imported-icon.{}", extension);

        tokio::fs::copy(path, profile_dir.join(&file_name))
            .await
            .ok()?;

        Some(ProfileBanner {
            source: ImageSource::RelativeProfile { path: file_name },
        })
    }
}
