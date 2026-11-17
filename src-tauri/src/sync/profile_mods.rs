use crate::error::Result;
use crate::state::profile_state::{mod_project_key, Mod, ModLoader, Profile};
use crate::state::state_manager::State;
use crate::sync::paths;
use crate::sync::model::{
    jar_exclusion_key, mod_exclusion_key, SyncPack, SyncPackModEntry, VersionOverride,
};
use crate::sync::resolution::{
    label_of, matrix_row, project_key_of, MatrixStatus, ResolutionCache, SyncPackModMatrixRow,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProfileSyncModStatus {
    Active,
    Pending,
    Disabled,
    DisabledForVersion,
    ExcludedHere,
    Shadowed,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProfileSyncPackMod {
    pub pack_id: Uuid,
    pub pack_name: String,
    pub pack_icon: Option<String>,
    pub mod_id: Option<Uuid>,
    pub mod_key: String,
    pub display_name: String,
    pub platform: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub version_name: Option<String>,
    pub filename: Option<String>,
    pub pinned: bool,
    pub status: ProfileSyncModStatus,
    pub shadowed_by_pack: Option<String>,
}

impl ProfileSyncPackMod {
    pub fn is_switched_on(&self) -> bool {
        !matches!(
            self.status,
            ProfileSyncModStatus::Disabled
                | ProfileSyncModStatus::DisabledForVersion
                | ProfileSyncModStatus::ExcludedHere
        )
    }

    fn in_pack(pack: &SyncPack, mod_key: String, display_name: String) -> Self {
        Self {
            pack_id: pack.id,
            pack_name: pack.name.clone(),
            pack_icon: pack.icon.clone(),
            mod_id: None,
            mod_key,
            display_name,
            platform: None,
            project_id: None,
            version_id: None,
            version_name: None,
            filename: None,
            pinned: false,
            status: ProfileSyncModStatus::Active,
            shadowed_by_pack: None,
        }
    }
}

pub struct ProfilePackInput {
    pub pack: SyncPack,
    pub cache: ResolutionCache,
    pub local_jars: Vec<String>,
    pub excluded: HashSet<String>,
}

struct Context<'a> {
    inputs: &'a [ProfilePackInput],
    profile_keys: HashSet<String>,
    owner_by_key: HashMap<String, usize>,
    mc_version: &'a str,
    loader: ModLoader,
}

fn contributes(entry: &SyncPackModEntry, input: &ProfilePackInput, mc_version: &str) -> bool {
    entry.info.enabled
        && !matches!(
            entry.override_for(mc_version),
            Some(VersionOverride::Disabled)
        )
        && !input.excluded.contains(&mod_exclusion_key(entry.info.id))
}

fn status_of(
    ctx: &Context,
    index: usize,
    entry: &SyncPackModEntry,
    key: Option<&String>,
    row: &SyncPackModMatrixRow,
) -> (ProfileSyncModStatus, Option<String>) {
    let input = &ctx.inputs[index];
    if !entry.info.enabled {
        return (ProfileSyncModStatus::Disabled, None);
    }
    if row.status == MatrixStatus::Disabled {
        return (ProfileSyncModStatus::DisabledForVersion, None);
    }
    if input.excluded.contains(&mod_exclusion_key(entry.info.id)) {
        return (ProfileSyncModStatus::ExcludedHere, None);
    }
    let Some(key) = key else {
        return (ProfileSyncModStatus::Active, None);
    };
    if ctx.profile_keys.contains(key) {
        return (ProfileSyncModStatus::Shadowed, None);
    }
    if let Some(winner) = ctx.owner_by_key.get(key).filter(|winner| **winner != index) {
        return (
            ProfileSyncModStatus::Shadowed,
            Some(ctx.inputs[*winner].pack.name.clone()),
        );
    }
    if row.status == MatrixStatus::Unresolved {
        return (ProfileSyncModStatus::Pending, None);
    }
    (ProfileSyncModStatus::Active, None)
}

fn view_of_mod(ctx: &Context, index: usize, entry: &SyncPackModEntry) -> ProfileSyncPackMod {
    let input = &ctx.inputs[index];
    let key = project_key_of(&entry.info.source);
    let cached = key.as_ref().and_then(|k| {
        input.cache.get(&(
            k.clone(),
            ctx.mc_version.to_string(),
            ctx.loader.as_str().to_string(),
        ))
    });
    let row = matrix_row(entry, ctx.mc_version, ctx.loader, cached);
    let (status, shadowed_by_pack) = status_of(ctx, index, entry, key.as_ref(), &row);

    let mut view = ProfileSyncPackMod::in_pack(
        &input.pack,
        mod_exclusion_key(entry.info.id),
        label_of(entry),
    );
    if let Some((platform, project_id)) = mod_project_key(&entry.info.source) {
        view.platform = Some(platform.to_string());
        view.project_id = Some(project_id.to_string());
    }
    view.mod_id = Some(entry.info.id);
    view.version_name = if key.is_some() {
        row.resolved_version_name.clone()
    } else {
        entry.info.version.clone()
    };
    view.version_id = row.resolved_version_id;
    view.filename = row.resolved_filename;
    view.pinned = row.status == MatrixStatus::OverridePinned;
    view.status = status;
    view.shadowed_by_pack = shadowed_by_pack;
    view
}

fn view_of_jar(input: &ProfilePackInput, jar: &str) -> ProfileSyncPackMod {
    let mut view =
        ProfileSyncPackMod::in_pack(&input.pack, jar_exclusion_key(jar), jar.to_string());
    view.filename = Some(jar.to_string());
    if input.excluded.contains(&view.mod_key) {
        view.status = ProfileSyncModStatus::ExcludedHere;
    }
    view
}

pub fn profile_pack_mods(
    inputs: &[ProfilePackInput],
    profile_mods: &[Mod],
    mc_version: &str,
    loader: ModLoader,
) -> Vec<ProfileSyncPackMod> {
    let profile_keys = profile_mods
        .iter()
        .filter(|m| m.enabled && m.targets_game_version(mc_version))
        .filter_map(|m| project_key_of(&m.source))
        .collect();

    let mut owner_by_key = HashMap::new();
    for (index, input) in inputs.iter().enumerate() {
        for entry in input
            .pack
            .mods
            .iter()
            .filter(|e| contributes(e, input, mc_version))
        {
            if let Some(key) = project_key_of(&entry.info.source) {
                owner_by_key.insert(key, index);
            }
        }
    }

    let ctx = Context {
        inputs,
        profile_keys,
        owner_by_key,
        mc_version,
        loader,
    };

    inputs
        .iter()
        .enumerate()
        .flat_map(|(index, input)| {
            let ctx = &ctx;
            input
                .pack
                .mods
                .iter()
                .map(move |entry| view_of_mod(ctx, index, entry))
                .chain(
                    input
                        .local_jars
                        .iter()
                        .map(move |jar| view_of_jar(input, jar)),
                )
        })
        .collect()
}

pub async fn load_for_profile(state: &State, profile: &Profile) -> Result<Vec<ProfileSyncPackMod>> {
    if profile.sync_pack_ids.is_empty() || paths::is_temp_profile_path(&profile.path) {
        return Ok(Vec::new());
    }

    let packs = state
        .sync_pack_manager
        .get_packs(&profile.sync_pack_ids)
        .await?;
    let mut exclusions = state
        .sync_pack_manager
        .get_profile_exclusions(profile.id)
        .await
        .unwrap_or_default();

    let mut inputs = Vec::new();
    for pack in packs.into_iter().filter(|pack| pack.enabled) {
        inputs.push(ProfilePackInput {
            excluded: exclusions.remove(&pack.id).unwrap_or_default(),
            cache: state
                .sync_pack_manager
                .get_mod_resolutions(pack.id)
                .await
                .unwrap_or_default(),
            local_jars: paths::list_pack_local_jar_names(pack.id)
                .await
                .unwrap_or_default(),
            pack,
        });
    }

    Ok(profile_pack_mods(
        &inputs,
        &profile.mods,
        &profile.game_version,
        profile.loader,
    ))
}
