use super::{param_str, redact_json, state};
use crate::commands::profile_command::resolve_profile_ref;
use crate::integrations::norisk_packs::validate_pack_target;
use crate::minecraft::temp_profile::{
    build_temp_profile, mod_references, prepare_temp_launch, run_temp_launch, validate_args,
    TempLaunchArgs,
};
use crate::state::profile_state::{ModLoader, Profile};
use crate::support::follow_up;
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ActionPlanView, ItemCategory, ItemParams};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct TempProfileHandler;

const KNOWN_PARAMS: &[&str] = &["minecraft", "loader", "loaderVersion", "pack", "modsFrom"];
const MAX_PROFILE_NAME_CHARS: usize = 64;
const TEMP_DESCRIPTION: &str = "Support test profile";

#[derive(Debug, Clone)]
pub struct TempSpec {
    pub args: TempLaunchArgs,
    pub mods_from: Option<String>,
}

fn is_valid_profile_name(name: &str) -> bool {
    let count = name.chars().count();
    (1..=MAX_PROFILE_NAME_CHARS).contains(&count)
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || " ._()+-".contains(c))
}

pub fn parse_spec(params: &ItemParams) -> Result<TempSpec, &'static str> {
    if !params
        .iter()
        .all(|(k, v)| KNOWN_PARAMS.contains(&k.as_str()) && v.is_string())
    {
        return Err("invalid_params");
    }
    let text = |key: &str| param_str(params, key).map(str::to_string);
    let minecraft = text("minecraft").ok_or("invalid_params")?;
    let loader = param_str(params, "loader")
        .and_then(|v| ModLoader::from_str(v).ok())
        .ok_or("invalid_params")?;
    let mods_from = text("modsFrom");
    if mods_from.as_deref().is_some_and(|n| !is_valid_profile_name(n)) {
        return Err("invalid_params");
    }
    let args = TempLaunchArgs {
        name: Some(format!("Support test {}", minecraft)),
        game_version: minecraft,
        loader: loader.as_str().to_string(),
        loader_version: text("loaderVersion"),
        pack: text("pack"),
        quick_play_singleplayer: None,
        quick_play_multiplayer: None,
        local_mods: Vec::new(),
        account: None,
        jvm_args: Vec::new(),
    };
    validate_args(&args)?;
    Ok(TempSpec { args, mods_from })
}

pub fn temp_profile_for(spec: &TempSpec, mods_from: Option<&Profile>) -> Result<Profile, String> {
    let mut profile = build_temp_profile(&spec.args, TEMP_DESCRIPTION).map_err(|e| e.to_string())?;
    profile.mods = mods_from.map(mod_references).unwrap_or_default();
    Ok(profile)
}

struct Planned {
    spec: TempSpec,
    profile: Profile,
    source: Option<String>,
}

async fn planned(params: &ItemParams) -> Result<Planned, String> {
    let spec = parse_spec(params)?;
    let state = state().await?;
    let source = match &spec.mods_from {
        Some(name) => Some(
            resolve_profile_ref(&state, name)
                .await
                .map_err(|_| "profile_not_found".to_string())?,
        ),
        None => None,
    };
    let profile = temp_profile_for(&spec, source.as_ref())?;
    if let Some(pack) = &spec.args.pack {
        let config = state.norisk_pack_manager.get_config().await;
        validate_pack_target(&config, &profile, pack).await?;
    }
    Ok(Planned {
        spec,
        profile,
        source: source.map(|s| s.name),
    })
}

fn describe(planned: &Planned) -> String {
    let args = &planned.spec.args;
    let mut parts = vec![format!("Minecraft {}", args.game_version), args.loader.clone()];
    parts.extend(args.loader_version.clone());
    parts.extend(args.pack.clone());
    if let Some(source) = &planned.source {
        parts.push(format!(
            "{} mods from \"{}\"",
            planned.profile.mods.len(),
            source
        ));
    }
    parts.join(" · ")
}

fn spec_data(spec: &TempSpec) -> Value {
    json!({
        "minecraft": spec.args.game_version,
        "loader": spec.args.loader,
        "loaderVersion": spec.args.loader_version,
        "pack": spec.args.pack,
        "modsFrom": spec.mods_from,
    })
}

async fn plan(params: &ItemParams) -> Result<PreparedItem, String> {
    let planned = planned(params).await?;
    Ok(PreparedItem::action(
        ActionPlanView {
            description: describe(&planned),
            ..Default::default()
        },
        spec_data(&planned.spec),
    ))
}

async fn start(ctx: &SupportContext, params: &ItemParams) -> Result<ActionOutcome, String> {
    let session = ctx.session()?.clone();
    let Planned { spec, profile, .. } = planned(params).await?;
    let profile_id = profile.id;
    let mut data = spec_data(&spec);
    data["profileName"] = json!(profile.name);
    data["modCount"] = json!(profile.mods.len());
    let launch = prepare_temp_launch(profile, spec.args)
        .await
        .map_err(|e| format!("launch_failed: {}", e.message))?;
    follow_up::watch(profile_id, session);
    if let Err(e) = run_temp_launch(launch).await {
        follow_up::forget(profile_id);
        return Err(format!("launch_failed: {}", e));
    }
    Ok(ActionOutcome::done_quiet(Some(redact_json(data, 128))))
}

#[async_trait]
impl SupportItemHandler for TempProfileHandler {
    fn type_id(&self) -> &'static str {
        "START_TEMP_PROFILE"
    }

    fn needs_profile(&self) -> bool {
        false
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Action
    }

    async fn prepare(&self, _ctx: &SupportContext, params: &ItemParams) -> PreparedItem {
        plan(params).await.unwrap_or_else(PreparedItem::failed)
    }

    async fn execute(
        &self,
        ctx: &SupportContext,
        params: &ItemParams,
        _prepared: &PreparedItem,
    ) -> ActionOutcome {
        start(ctx, params)
            .await
            .unwrap_or_else(ActionOutcome::failed)
    }
}
