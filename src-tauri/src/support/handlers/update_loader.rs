use super::{
    check_editable, clean_loader_version, editable_profile, from_to_data,
    is_valid_loader_version, resolved_loader_version, save_profile, state,
};
use crate::minecraft::modloader::ModloaderFactory;
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ActionPlanView, ItemCategory, ItemParams};
use async_trait::async_trait;
use log::{info, warn};
use serde_json::json;

pub struct UpdateLoaderHandler;

const VANILLA_REASON: &str = "no_loader: profile uses vanilla Minecraft";
const OFFLINE_REASON: &str = "offline: could not load the loader version list";

fn loader_label(loader: &ModLoader) -> &'static str {
    match loader {
        ModLoader::Fabric => "Fabric",
        ModLoader::Quilt => "Quilt",
        ModLoader::Forge => "Forge",
        ModLoader::NeoForge => "NeoForge",
        ModLoader::Vanilla => "Vanilla",
    }
}

async fn available_versions(profile: &Profile) -> Result<Vec<String>, String> {
    ModloaderFactory::list_loader_versions(&profile.loader, &profile.game_version)
        .await
        .map_err(|e| {
            warn!("[Support] UPDATE_LOADER version list failed: {}", e);
            OFFLINE_REASON.to_string()
        })
}

pub fn latest_stable(loader: &ModLoader, versions: &[String]) -> String {
    let is_stable = |v: &String| match loader {
        ModLoader::Fabric | ModLoader::Quilt => v.trim_end().ends_with("(stable)"),
        _ => {
            let lower = v.to_ascii_lowercase();
            !["alpha", "beta", "rc", "pre", "snapshot"]
                .iter()
                .any(|tag| lower.contains(tag))
        }
    };
    versions
        .iter()
        .find(|v| is_stable(v))
        .or_else(|| versions.first())
        .cloned()
        .unwrap_or_default()
}

fn requested_version(params: &ItemParams) -> String {
    ["version", "target", "loaderVersion"]
        .iter()
        .find_map(|k| params.get(*k).and_then(|v| v.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "latest".to_string())
}

async fn current_version(state: &State, profile: &Profile) -> Option<String> {
    resolved_loader_version(state, profile)
        .await
        .filter(|v| is_valid_loader_version(v))
}

fn concrete(target: &str) -> Result<String, String> {
    let to = clean_loader_version(target);
    if is_valid_loader_version(&to) {
        Ok(to)
    } else {
        Err(format!(
            "unknown_version: \"{}\" is not a concrete loader version",
            to
        ))
    }
}

fn change_line(profile: &Profile, from: Option<&str>, to: &str) -> String {
    format!(
        "{} Loader {} -> {} for profile \"{}\"",
        loader_label(&profile.loader),
        from.unwrap_or("?"),
        to,
        profile.name
    )
}

async fn plan(ctx: &SupportContext, params: &ItemParams) -> Result<PreparedItem, String> {
    let profile = &ctx.profile;
    check_editable(profile, VANILLA_REASON)?;
    if let Some(loader) = params.get("loader").and_then(|v| v.as_str()) {
        if !loader.eq_ignore_ascii_case(profile.loader.as_str()) {
            return Err(format!(
                "loader_mismatch: request is for {}, profile uses {}",
                loader,
                profile.loader.as_str()
            ));
        }
    }

    let versions = available_versions(profile).await?;
    if versions.is_empty() {
        return Err(format!(
            "no_versions: no {} versions for Minecraft {}",
            loader_label(&profile.loader),
            profile.game_version
        ));
    }

    let wanted = requested_version(params);
    let target = if wanted.eq_ignore_ascii_case("latest") {
        latest_stable(&profile.loader, &versions)
    } else {
        let wanted_clean = clean_loader_version(&wanted);
        versions
            .iter()
            .find(|v| clean_loader_version(v) == wanted_clean)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "unknown_version: {} {} does not exist for Minecraft {}",
                    loader_label(&profile.loader),
                    wanted_clean,
                    profile.game_version
                )
            })?
    };

    let from = current_version(&*state().await?, profile).await;
    let to = concrete(&target)?;
    let description = if from.as_deref() == Some(to.as_str()) {
        format!("{} Loader is already {}", loader_label(&profile.loader), to)
    } else {
        change_line(profile, from.as_deref(), &to)
    };
    Ok(PreparedItem::action(
        ActionPlanView {
            description,
            from,
            to: Some(to),
            ..Default::default()
        },
        json!({
            "profileId": profile.id.to_string(),
            "loader": profile.loader.as_str(),
            "target": target,
        }),
    ))
}

async fn apply(ctx: &SupportContext, prepared: &PreparedItem) -> Result<ActionOutcome, String> {
    let (Some(target), Some(planned_loader)) =
        (prepared.plan_str("target"), prepared.plan_str("loader"))
    else {
        return Err("not_prepared".into());
    };
    let (state, mut profile) = editable_profile(ctx, VANILLA_REASON).await?;
    if profile.loader.as_str() != planned_loader {
        return Err("loader_changed: the profile's loader changed since preparing".into());
    }
    if !available_versions(&profile).await?.iter().any(|v| v == target) {
        return Err("unknown_version: target version no longer available".into());
    }

    let from = current_version(&state, &profile).await;
    let to = concrete(target)?;
    profile.settings.use_overwrite_loader_version = true;
    profile.settings.overwrite_loader_version = None;
    profile
        .settings
        .overwrite_loader_versions
        .insert(profile.loader.as_str().to_string(), target.to_string());
    save_profile(&state, &profile).await?;
    info!(
        "[Support] UPDATE_LOADER: {} loader of profile {} set {:?} -> {}",
        loader_label(&profile.loader),
        profile.id,
        from,
        to
    );
    Ok(ActionOutcome::done(
        format!(
            "{} (installed on next launch)",
            change_line(&profile, from.as_deref(), &to)
        ),
        Some(from_to_data(from.as_deref(), &to)),
    ))
}

#[async_trait]
impl SupportItemHandler for UpdateLoaderHandler {
    fn type_id(&self) -> &'static str {
        "UPDATE_LOADER"
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
