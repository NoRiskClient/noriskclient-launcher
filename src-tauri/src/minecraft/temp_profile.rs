use crate::commands::profile_command::{
    resolve_credentials_for_account, resolve_credentials_for_profile, resolve_local_mod_paths,
};
use crate::error::{AppError, CommandError};
use crate::integrations::norisk_packs::is_valid_pack_id;
use crate::minecraft::auth::minecraft_auth::Credentials;
use crate::minecraft::installer;
use crate::state::profile_state::{
    Mod, ModLoader, ModSource, Profile, ProfileSettings, ProfileState,
};
use crate::state::state_manager::State;
use chrono::Utc;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;
use uuid::Uuid;

/// Args for `launch_temp_profile`. Wired by `cli.rs` from the `temp` subcommand
/// (or callable from the frontend later if needed).
#[derive(Deserialize, Debug, Clone)]
pub struct TempLaunchArgs {
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub pack: Option<String>,
    pub name: Option<String>,
    pub quick_play_singleplayer: Option<String>,
    pub quick_play_multiplayer: Option<String>,
    /// CLI `--mods`: local jar paths to load in-place (not copied).
    #[serde(default)]
    pub local_mods: Vec<String>,
    /// CLI `--account`: launch with this account (username or UUID).
    pub account: Option<String>,
    #[serde(default)]
    pub jvm_args: Vec<String>,
}

fn is_version_like(version: &str, max_len: usize) -> bool {
    let mut chars = version.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_digit())
        && version.len() <= max_len
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '_' | '-'))
}

pub fn is_valid_loader_version(version: &str) -> bool {
    is_version_like(version, 64)
}

pub fn is_valid_minecraft_version(version: &str) -> bool {
    is_version_like(version, 32)
}

pub fn validate_args(args: &TempLaunchArgs) -> Result<(), &'static str> {
    let valid = is_valid_minecraft_version(&args.game_version)
        && ModLoader::from_str(&args.loader).is_ok()
        && args.loader_version.as_deref().map_or(true, is_valid_loader_version)
        && args.pack.as_deref().map_or(true, is_valid_pack_id);
    if valid {
        Ok(())
    } else {
        Err("invalid_params")
    }
}

pub fn build_temp_profile(args: &TempLaunchArgs, description: &str) -> Result<Profile, AppError> {
    let id = Uuid::new_v4();
    let short: String = id.to_string().chars().take(8).collect();
    let loader = ModLoader::from_str(&args.loader)
        .map_err(|_| AppError::Other(format!("Invalid loader: '{}'", args.loader)))?;
    let mut profile = Profile {
        id,
        name: args
            .name
            .clone()
            .unwrap_or_else(|| format!("temp-{}", short)),
        path: format!("noriskclient/temp/{}", id),
        game_version: args.game_version.clone(),
        loader,
        loader_version: args.loader_version.clone(),
        created: Utc::now(),
        last_played: None,
        settings: ProfileSettings::default(),
        state: ProfileState::NotInstalled,
        mods: Vec::new(),
        selected_norisk_pack_id: args.pack.clone(),
        disabled_norisk_mods_detailed: HashSet::new(),
        source_standard_profile_id: None,
        use_shared_minecraft_folder: false,
        group: None,
        description: Some(description.into()),
        banner: None,
        background: None,
        is_standard_version: false,
        norisk_information: None,
        modpack_info: None,
        preferred_account_id: None,
        playtime_seconds: 0,
        sync_pack_ids: Vec::new(),
        extra: Default::default(),
    };
    profile
        .extra
        .insert("is_temporary".into(), serde_json::Value::Bool(true));
    Ok(profile)
}

pub fn mod_references(source: &Profile) -> Vec<Mod> {
    source
        .mods
        .iter()
        .filter(|m| {
            matches!(
                m.source,
                ModSource::Modrinth { .. } | ModSource::CurseForge { .. }
            )
        })
        .map(|m| Mod {
            id: Uuid::new_v4(),
            ..m.clone()
        })
        .collect()
}

pub struct PreparedTempLaunch {
    pub profile: Profile,
    credentials: Option<Credentials>,
    local_mod_paths: Vec<PathBuf>,
    args: TempLaunchArgs,
}

pub async fn prepare_temp_launch(
    profile: Profile,
    args: TempLaunchArgs,
) -> Result<PreparedTempLaunch, CommandError> {
    let state = State::get().await?;
    let game_dir = state
        .profile_manager
        .calculate_instance_path_for_profile(&profile)?;
    log::info!(
        "[temp] launch id={} name='{}' dir={:?} mc={} loader={} loader_version={:?} pack={:?} mods={} quick_play_sp={:?} quick_play_mp={:?} jvm_args={:?}",
        profile.id,
        profile.name,
        game_dir,
        profile.game_version,
        profile.loader.as_str(),
        profile.loader_version,
        profile.selected_norisk_pack_id,
        profile.mods.len(),
        args.quick_play_singleplayer,
        args.quick_play_multiplayer,
        args.jvm_args,
    );

    let is_experimental = state.config_manager.is_experimental_mode().await;
    let credentials = match &args.account {
        Some(acc) => Some(resolve_credentials_for_account(&state, acc, is_experimental).await?),
        None => resolve_credentials_for_profile(&state, &profile, is_experimental).await?,
    };
    state
        .profile_manager
        .register_transient_profile(profile.clone())
        .await;
    let local_mod_paths = resolve_local_mod_paths(&args.local_mods).await?;
    Ok(PreparedTempLaunch {
        profile,
        credentials,
        local_mod_paths,
        args,
    })
}

pub async fn run_temp_launch(launch: PreparedTempLaunch) -> Result<(), AppError> {
    let PreparedTempLaunch {
        profile,
        credentials,
        local_mod_paths,
        args,
    } = launch;
    installer::install_minecraft_version(
        &profile.game_version,
        profile.loader.as_str(),
        &profile,
        credentials,
        args.quick_play_singleplayer,
        args.quick_play_multiplayer,
        None,
        local_mod_paths,
        args.jvm_args,
        false,
    )
    .await
}
