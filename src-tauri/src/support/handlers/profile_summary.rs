use super::{redacted_data, resolved_loader_version, state};
use crate::support::files::read_head_lossy;
use crate::support::handler::{PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ItemCategory, ItemParams};
use async_trait::async_trait;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::path::Path;

pub struct ProfileSummaryHandler;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub version: Option<String>,
    pub vendor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSummary {
    profile_name: String,
    minecraft_version: String,
    loader: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    loader_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    norisk_pack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    java_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    java_vendor: Option<String>,
    memory_max_mb: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    mod_count: Option<u32>,
}

const MAX_FIELD_CHARS: usize = 128;
const JAVA_LOG_HEAD_BYTES: u64 = 256 * 1024;

static JAVA_LOG_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"Java is (?P<vendor>[^,\n]+), version (?P<version>[^\s,]+)").unwrap(),
        Regex::new(r"JVM identified as (?P<vendor>.+?) (?P<version>\d[^\s]*)\s*$").unwrap(),
        Regex::new(r"JRE version: (?P<vendor>[^(\n]+?) \((?P<version>[^)\s]+)\)").unwrap(),
    ]
});

pub fn java_from_text(text: &str) -> Option<JavaRuntime> {
    text.lines().find_map(|line| {
        JAVA_LOG_PATTERNS.iter().find_map(|re| {
            let c = re.captures(line)?;
            let field = |name: &str| c.name(name).map(|m| m.as_str().trim().to_string());
            Some(JavaRuntime {
                version: field("version"),
                vendor: field("vendor"),
            })
        })
    })
}

pub async fn detect_profile_java(ctx: &SupportContext) -> JavaRuntime {
    let settings = &ctx.profile.settings;
    let custom_path = settings
        .java_path
        .as_deref()
        .filter(|p| settings.use_custom_java_path && !p.trim().is_empty());
    if let Some(path) = custom_path {
        if let Ok(info) = crate::utils::java_detector::get_java_info(Path::new(path)).await {
            return JavaRuntime {
                version: Some(info.version),
                vendor: Some(info.vendor).filter(|v| !v.trim().is_empty()),
            };
        }
    }

    let latest = ctx.instance_path.join("logs").join("latest.log");
    tokio::task::spawn_blocking(move || {
        read_head_lossy(&latest, JAVA_LOG_HEAD_BYTES).and_then(|text| java_from_text(&text))
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default()
}

#[async_trait]
impl SupportItemHandler for ProfileSummaryHandler {
    fn type_id(&self) -> &'static str {
        "PROFILE_SUMMARY"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Collect
    }

    async fn prepare(&self, ctx: &SupportContext, _params: &ItemParams) -> PreparedItem {
        let profile = &ctx.profile;
        let state = match state().await {
            Ok(s) => s,
            Err(e) => return PreparedItem::failed(e),
        };

        let memory_max_mb = if profile.is_standard_version {
            state.config_manager.get_config().await.global_memory_settings.max
        } else {
            profile.settings.memory.max
        };
        let java = detect_profile_java(ctx).await;
        let mod_count = super::mod_list::collect_mods(ctx)
            .await
            .ok()
            .map(|m| u32::try_from(m.len()).unwrap_or(u32::MAX));

        let summary = ProfileSummary {
            profile_name: profile.name.clone(),
            minecraft_version: profile.game_version.clone(),
            loader: profile.loader.as_str().to_string(),
            loader_version: resolved_loader_version(&state, profile).await,
            norisk_pack: profile.effective_norisk_pack_id().await,
            java_version: java.version,
            java_vendor: java.vendor,
            memory_max_mb,
            mod_count,
        };
        let line = format!(
            "{} · Minecraft {} · {}{}",
            summary.profile_name,
            summary.minecraft_version,
            summary.loader,
            summary
                .loader_version
                .as_deref()
                .map(|v| format!(" {}", v))
                .unwrap_or_default()
        );
        redacted_data(&summary, MAX_FIELD_CHARS, line)
    }
}
