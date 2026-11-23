use super::{check_editable, editable_profile, from_to_data, save_profile, state};
use crate::commands::permission_commands::has_permission_internal;
use crate::integrations::norisk_packs::NoriskModpacksConfig;
use crate::state::profile_state::Profile;
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ActionPlanView, ItemCategory, ItemParams};
use async_trait::async_trait;
use log::info;
use serde_json::json;

pub struct SwitchPackHandler;

const DEV_PACK_PREFIX: &str = "dev-";
const STAFF_PERMISSION: &str = "norisk.staff";
const DEV_PACK_PERMISSION_PREFIX: &str = "norisk.pack.dev.";
const VANILLA_REASON: &str = "profile_locked: vanilla profiles cannot use a NoRisk pack";

fn is_valid_pack_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && (2..=64).contains(&id.len())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

async fn may_view_pack(id: &str) -> bool {
    match id.strip_prefix(DEV_PACK_PREFIX) {
        None => true,
        Some(rest) => {
            has_permission_internal(STAFF_PERMISSION).await
                || has_permission_internal(&format!("{}{}", DEV_PACK_PERMISSION_PREFIX, rest)).await
        }
    }
}

fn display_name(config: &NoriskModpacksConfig, id: &str) -> Option<String> {
    config
        .packs
        .get(id)
        .map(|p| p.display_name.trim().to_string())
        .filter(|n| !n.is_empty())
}

fn current_pack(profile: &Profile) -> Option<String> {
    profile
        .selected_norisk_pack_id
        .clone()
        .filter(|p| !p.is_empty())
}

async fn validate_target(
    config: &NoriskModpacksConfig,
    profile: &Profile,
    pack: &str,
) -> Result<(), String> {
    if !is_valid_pack_id(pack) {
        return Err(format!("unknown_pack: \"{}\" is not a valid pack id", pack));
    }
    if !config.packs.contains_key(pack) || !may_view_pack(pack).await {
        return Err(format!("unknown_pack: {} is not available", pack));
    }
    let resolved = config
        .get_resolved_pack_definition(pack)
        .map_err(|e| format!("unknown_pack: {} cannot be resolved: {}", pack, e))?;
    let supports_profile = resolved.mods.is_empty()
        || resolved.mods.iter().any(|m| {
            m.compatibility
                .get(&profile.game_version)
                .is_some_and(|by_loader| by_loader.contains_key(profile.loader.as_str()))
        });
    if !supports_profile {
        return Err(format!(
            "unsupported_version: {} has no mods for Minecraft {} with {}",
            pack,
            profile.game_version,
            profile.loader.as_str()
        ));
    }
    Ok(())
}

async fn plan(ctx: &SupportContext, params: &ItemParams) -> Result<PreparedItem, String> {
    let profile = &ctx.profile;
    check_editable(profile, VANILLA_REASON)?;
    let pack = params
        .get("pack")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .ok_or("unknown_pack: no pack given")?;
    let config = state().await?.norisk_pack_manager.get_config().await;
    validate_target(&config, profile, &pack).await?;

    let from = current_pack(profile);
    let from_name = from.as_deref().and_then(|f| display_name(&config, f));
    let to_name = display_name(&config, &pack);
    let label = |id: &str, name: &Option<String>| match name {
        Some(n) => format!("{} ({})", n, id),
        None => id.to_string(),
    };
    let description = if from.as_deref() == Some(pack.as_str()) {
        format!("Profile is already on {}", label(&pack, &to_name))
    } else {
        format!(
            "NoRisk pack {} -> {} for profile \"{}\"",
            from.as_deref()
                .map_or_else(|| "none".into(), |f| label(f, &from_name)),
            label(&pack, &to_name),
            profile.name
        )
    };
    Ok(PreparedItem::action(
        ActionPlanView {
            description,
            from,
            to: Some(pack.clone()),
            from_name,
            to_name,
        },
        json!({ "pack": pack }),
    ))
}

async fn apply(ctx: &SupportContext, prepared: &PreparedItem) -> Result<ActionOutcome, String> {
    let pack = prepared.plan_str("pack").ok_or("not_prepared")?.to_string();
    let (state, mut profile) = editable_profile(ctx, VANILLA_REASON).await?;
    let config = state.norisk_pack_manager.get_config().await;
    validate_target(&config, &profile, &pack).await?;

    let from = current_pack(&profile);
    let data = from_to_data(from.as_deref(), &pack);
    if from.as_deref() == Some(pack.as_str()) {
        return Ok(ActionOutcome::done(format!("already on {}", pack), Some(data)));
    }

    profile.selected_norisk_pack_id = Some(pack.clone());
    save_profile(&state, &profile).await?;
    info!(
        "[Support] SWITCH_PACK: profile {} pack {:?} -> {}",
        profile.id, from, pack
    );
    Ok(ActionOutcome::done(
        format!(
            "NoRisk pack {} -> {} for profile \"{}\" (applied on next launch)",
            from.as_deref().unwrap_or("none"),
            pack,
            profile.name
        ),
        Some(data),
    ))
}

#[async_trait]
impl SupportItemHandler for SwitchPackHandler {
    fn type_id(&self) -> &'static str {
        "SWITCH_PACK"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Action
    }

    async fn prepare(&self, ctx: &SupportContext, params: &ItemParams) -> PreparedItem {
        plan(ctx, params).await.unwrap_or_else(PreparedItem::failed)
    }

    async fn execute(
        &self,
        ctx: &SupportContext,
        _params: &ItemParams,
        prepared: &PreparedItem,
    ) -> ActionOutcome {
        apply(ctx, prepared).await.unwrap_or_else(ActionOutcome::failed)
    }
}
