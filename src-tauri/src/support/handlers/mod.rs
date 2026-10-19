pub mod logs;
pub mod mc_settings;
pub mod mod_list;
pub mod nrc_profile;
pub mod profile_summary;
pub mod switch_pack;
pub mod system_info;
pub mod update_loader;

use crate::minecraft::modloader::ModloaderFactory;
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use crate::support::handler::{PreparedItem, SupportContext};
use crate::utils::security_utils::mask_sensitive_data;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

pub fn redact_json(value: Value, max_chars: usize) -> Value {
    match value {
        Value::String(s) => Value::String(cap_str(&mask_sensitive_data(&s), max_chars)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|v| redact_json(v, max_chars))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, redact_json(v, max_chars)))
                .filter(|(_, v)| match v {
                    Value::Null => false,
                    Value::String(s) => !s.trim().is_empty(),
                    _ => true,
                })
                .collect(),
        ),
        other => other,
    }
}

pub fn redacted_data(value: &impl Serialize, max_chars: usize, summary: String) -> PreparedItem {
    match serde_json::to_value(value) {
        Ok(data) => PreparedItem::data(
            redact_json(data, max_chars),
            Some(mask_sensitive_data(&summary)),
        ),
        Err(e) => PreparedItem::failed(format!("internal error: {}", e)),
    }
}

fn cap_str(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => s[..idx].to_string(),
        None => s.to_string(),
    }
}

pub fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_string())
}

pub fn clean_loader_version(version: &str) -> String {
    version
        .trim()
        .trim_end_matches("(stable)")
        .trim()
        .to_string()
}

fn is_valid_loader_version(version: &str) -> bool {
    let mut chars = version.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_digit())
        && version.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '_' | '-'))
}

pub async fn state() -> Result<Arc<State>, String> {
    State::get()
        .await
        .map_err(|e| format!("internal error: {}", e))
}

pub async fn resolved_loader_version(state: &State, profile: &Profile) -> Option<String> {
    if profile.loader == ModLoader::Vanilla {
        return None;
    }
    let pack_config = state.norisk_pack_manager.get_config().await;
    ModloaderFactory::resolve_loader_version(profile, &profile.game_version, Some(&pack_config))
        .await
        .version
        .map(|v| clean_loader_version(&v))
}

fn lock_reason(profile: &Profile, vanilla_reason: &'static str) -> Option<&'static str> {
    if profile.is_standard_version {
        return Some("profile_locked: standard NoRisk profiles are managed by the launcher");
    }
    (profile.loader == ModLoader::Vanilla).then_some(vanilla_reason)
}

pub fn check_editable(profile: &Profile, vanilla_reason: &'static str) -> Result<(), String> {
    lock_reason(profile, vanilla_reason).map_or(Ok(()), |r| Err(r.to_string()))
}

pub async fn editable_profile(
    ctx: &SupportContext,
    vanilla_reason: &'static str,
) -> Result<(Arc<State>, Profile), String> {
    let state = state().await?;
    let profile = state
        .profile_manager
        .get_profile(ctx.profile.id)
        .await
        .map_err(|e| format!("profile_not_found: {}", e))?;
    check_editable(&profile, vanilla_reason)?;
    Ok((state, profile))
}

pub async fn save_profile(state: &State, profile: &Profile) -> Result<(), String> {
    state
        .profile_manager
        .update_profile(profile.id, profile.clone())
        .await
        .map_err(|e| format!("save_failed: {}", e))
}

pub fn from_to_data(from: Option<&str>, to: &str) -> Value {
    match from {
        Some(from) => serde_json::json!({ "from": from, "to": to }),
        None => serde_json::json!({ "to": to }),
    }
}
