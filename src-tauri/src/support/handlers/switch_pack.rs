use super::{check_editable, editable_profile, from_to_data, param_str, save_profile, state};
use crate::integrations::norisk_packs::{validate_pack_target, NoriskModpacksConfig};
use crate::state::profile_state::Profile;
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ActionPlanView, ItemCategory, ItemParams};
use async_trait::async_trait;
use log::info;
use serde_json::json;

pub struct SwitchPackHandler;

const VANILLA_REASON: &str = "profile_locked: vanilla profiles cannot use a NoRisk pack";

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

async fn plan(ctx: &SupportContext, params: &ItemParams) -> Result<PreparedItem, String> {
    let profile = ctx.profile()?;
    check_editable(profile, VANILLA_REASON)?;
    let pack = param_str(params, "pack")
        .map(str::to_string)
        .ok_or("unknown_pack: no pack given")?;
    let config = state().await?.norisk_pack_manager.get_config().await;
    validate_pack_target(&config, profile, &pack).await?;

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
    validate_pack_target(&config, &profile, &pack).await?;

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
