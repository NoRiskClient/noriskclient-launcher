use crate::error::{AppError, CommandError};
use crate::integrations::modrinth::{self, ModrinthVersion};
use crate::integrations::unified_mod::{self, ModPlatform, UnifiedModVersionsParams, UnifiedVersion};
use crate::state::profile_state::{mod_platform_ids, Mod, ModLoader, ModSource, NoriskModIdentifier, Profile};
use crate::state::state_manager::State;
use crate::sync::model::VersionOverride;
use crate::sync::profile_mods::{self, ProfileSyncModStatus, ProfileSyncPackMod};
use log::info;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Apply / revert a crash-analysis fix on a profile. Returns an opaque AppliedFix token for undo.
// update_mod + resolve_conflict cover Modrinth and CurseForge (platform from the installed mod);
// install_mod is Modrinth-only. Unsupported cases return Skipped instead of touching the wrong mod.

/// Mirror of the launcher TS `CrashAction` (extra fields are ignored).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrashActionDto {
    #[serde(rename = "type")]
    pub action_type: String,
    pub target: String,
    pub target_version: Option<String>,
    pub targets: Option<Vec<String>>,      // resolve_conflict: the incompatible mod set
    pub direction: Option<String>,         // resolve_conflict: "upgrade" | "downgrade"
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ConflictRevert {
    pub mod_id: Uuid,
    pub prev: UnifiedVersion,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncPinRevert {
    pub pack_id: Uuid,
    pub mod_id: Uuid,
    pub mc_version: String,
    pub prev: Option<VersionOverride>,
}

impl SyncPinRevert {
    async fn set(&self, state: &State, value: Option<VersionOverride>) -> Result<(), CommandError> {
        state
            .sync_pack_manager
            .set_mod_version_override(self.pack_id, self.mod_id, &self.mc_version, value)
            .await?;
        Ok(())
    }
}

/// Revert token — opaque to the UI; passed straight back to `revert_crash_fix`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppliedFix {
    Disable { profile_id: Uuid, mod_id: Uuid },
    Enable { profile_id: Uuid, mod_id: Uuid },
    NoriskMod {
        profile_id: Uuid,
        pack_id: String,
        mod_id: String,
        game_version: String,
        loader: ModLoader,
        prev_disabled: bool,
    },
    Install { profile_id: Uuid, new_mod_id: Uuid },
    Loader {
        profile_id: Uuid,
        loader_key: String,
        prev_use_overwrite: bool,
        prev_legacy: Option<String>,
        prev_map: Option<String>,
    },
    Modver { profile_id: Uuid, mod_id: Uuid, prev: UnifiedVersion },
    Conflict {
        profile_id: Uuid,
        mods: Vec<ConflictRevert>,
        #[serde(default)]
        sync_pins: Vec<SyncPinRevert>,
    },
    SyncExclusion { profile_id: Uuid, pack_id: Uuid, mod_key: String, excluded: bool },
    Pack { profile_id: Uuid, prev_pack_id: Option<String> },
    Repair { profile_id: Uuid },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApplyOutcome {
    Applied { fix: AppliedFix },
    Skipped { reason: String },
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

fn source_file_name(m: &Mod) -> Option<&str> {
    match &m.source {
        ModSource::Local { file_name } => Some(file_name),
        ModSource::Url { file_name, .. } => file_name.as_deref(),
        ModSource::Modrinth { file_name, .. } => Some(file_name),
        ModSource::CurseForge { file_name, .. } => Some(file_name),
        _ => None,
    }
}

/// mod-id token from a jar name, e.g. "sodium-fabric-mc1.21.11-0.6.20.jar" -> "sodium".
fn mod_id_from_file(fname: &str) -> String {
    let base = fname.strip_suffix(".jar").unwrap_or(fname).to_lowercase();
    for marker in ["-fabric", "-forge", "-neoforge", "-quilt", "-mc", "_fabric", "_forge", "_neoforge"] {
        if let Some(i) = base.find(marker) {
            return base[..i].to_string();
        }
    }
    base.split(|c| c == '-' || c == '_').next().unwrap_or(&base).to_string()
}

fn matches_target(target: &str, name: Option<&str>, file: Option<&str>, project_id: Option<&str>) -> bool {
    let t = norm(target);
    name.map_or(false, |d| norm(d) == t)
        || file.map_or(false, |f| mod_id_from_file(f) == target.to_lowercase())
        || project_id.map_or(false, |p| norm(p) == t)
}

/// find the installed mod for a mod-id, preferring the enabled instance (a disabled one isn't the
/// active culprit). None when unsure.
fn find_installed_mod<'a>(profile: &'a Profile, target: &str) -> Option<&'a Mod> {
    let matches = |m: &&Mod| {
        let project_id = match &m.source {
            ModSource::Modrinth { project_id, .. } => Some(project_id.as_str()),
            _ => None,
        };
        matches_target(target, m.display_name.as_deref(), source_file_name(m), project_id)
    };
    profile.mods.iter().find(|m| m.enabled && matches(m)).or_else(|| profile.mods.iter().find(matches))
}

enum Installed<'a> {
    Profile(&'a Mod),
    Sync(ProfileSyncPackMod),
}

async fn find_target<'a>(state: &State, profile: &'a Profile, target: &str) -> Result<Option<Installed<'a>>, CommandError> {
    let profile_mod = find_installed_mod(profile, target);
    if let Some(m) = profile_mod.filter(|m| m.enabled) {
        return Ok(Some(Installed::Profile(m)));
    }
    let sync_mod = profile_mods::load_for_profile(state, profile)
        .await?
        .into_iter()
        .filter(|entry| {
            matches_target(target, Some(&entry.display_name), entry.filename.as_deref(), entry.project_id.as_deref())
        })
        .max_by_key(|entry| entry.is_switched_on());
    Ok(match (profile_mod, sync_mod) {
        (_, Some(entry)) if entry.is_switched_on() => Some(Installed::Sync(entry)),
        (Some(m), _) => Some(Installed::Profile(m)),
        (None, entry) => entry.map(Installed::Sync),
    })
}

async fn sync_mod_versions(entry: &ProfileSyncPackMod, loader: &str) -> Result<Option<(Uuid, Vec<UnifiedVersion>)>, CommandError> {
    let platform = match entry.platform.as_deref() {
        Some("modrinth") => ModPlatform::Modrinth,
        Some("curseforge") => ModPlatform::CurseForge,
        _ => return Ok(None),
    };
    let (Some(mod_id), Some(project_id)) = (entry.mod_id, entry.project_id.as_deref()) else {
        return Ok(None);
    };
    Ok(Some((mod_id, unified_versions(platform, project_id, loader).await?)))
}

async fn set_sync_exclusion(state: &State, profile_id: Uuid, entry: &ProfileSyncPackMod, excluded: bool) -> Result<AppliedFix, CommandError> {
    state
        .sync_pack_manager
        .set_profile_exclusions(profile_id, &[(entry.pack_id, entry.mod_key.clone())], excluded)
        .await?;
    Ok(AppliedFix::SyncExclusion { profile_id, pack_id: entry.pack_id, mod_key: entry.mod_key.clone(), excluded })
}

async fn pin_sync_version(state: &State, profile: &Profile, entry: &ProfileSyncPackMod, mod_id: Uuid, version_id: &str) -> Result<SyncPinRevert, CommandError> {
    let pin = SyncPinRevert {
        pack_id: entry.pack_id,
        mod_id,
        mc_version: profile.game_version.clone(),
        prev: entry
            .version_id
            .clone()
            .filter(|_| entry.pinned)
            .map(|version_id| VersionOverride::Pin { version_id }),
    };
    pin.set(state, Some(VersionOverride::Pin { version_id: version_id.to_string() })).await?;
    Ok(pin)
}

fn pick_update_target<'a>(versions: &'a [UnifiedVersion], want: Option<&str>, mc: &str) -> Option<&'a UnifiedVersion> {
    want.and_then(|w| versions.iter().find(|v| v.version_number == w || v.version_number.starts_with(w)))
        .or_else(|| versions.iter().filter(|v| v.game_versions.iter().any(|g| g == mc)).max_by(|a, b| a.date_published.cmp(&b.date_published)))
        .or_else(|| versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)))
}

/// resolve a Modrinth version for slug+mc+loader, preferring an exact version_number, else newest.
async fn resolve_version(
    slug: &str,
    mc: &str,
    loader: &str,
    want: Option<&str>,
) -> Result<Option<ModrinthVersion>, CommandError> {
    let versions =
        modrinth::get_mod_versions(slug.to_string(), Some(vec![loader.to_string()]), Some(vec![mc.to_string()])).await?;
    if versions.is_empty() {
        return Ok(None);
    }
    if let Some(w) = want {
        if let Some(v) = versions.iter().find(|v| v.version_number == w || v.version_number.starts_with(w)) {
            return Ok(Some(v.clone()));
        }
    }
    Ok(versions.into_iter().next())
}

fn skip(reason: &str) -> ApplyOutcome {
    ApplyOutcome::Skipped { reason: reason.to_string() }
}

/// pick a version by direction, by publish date (order-independent across platforms):
/// upgrade -> newest available; downgrade -> newest published strictly before the current version.
fn pick_directional(versions: &[UnifiedVersion], current_id: &str, downgrade: bool) -> Option<UnifiedVersion> {
    if !downgrade {
        return versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)).cloned();
    }
    let current_date = versions.iter().find(|v| v.id == current_id)?.date_published.clone();
    versions.iter()
        .filter(|v| v.date_published < current_date)
        .max_by(|a, b| a.date_published.cmp(&b.date_published))
        .cloned()
}

/// loader-compatible versions for a project on its platform (game-version filtering is done by the caller).
async fn unified_versions(platform: ModPlatform, project_id: &str, loader: &str) -> Result<Vec<UnifiedVersion>, CommandError> {
    let resp = unified_mod::get_mod_versions_unified(UnifiedModVersionsParams {
        source: platform,
        project_id: project_id.to_string(),
        loaders: Some(vec![loader.to_string()]),
        game_versions: None,
        limit: None,
        offset: None,
    }).await?;
    Ok(resp.versions)
}

#[tauri::command]
pub async fn apply_crash_fix(profile_id: Uuid, action: CrashActionDto) -> Result<ApplyOutcome, CommandError> {
    let state = State::get().await?;
    let pm = &state.profile_manager;
    let profile = pm.get_profile(profile_id).await?;
    let loader = profile.loader.as_str().to_string();
    let mc = profile.game_version.clone();
    info!("[CrashFix] apply {}:{} on profile {}", action.action_type, action.target, profile_id);

    match action.action_type.as_str() {
        "disable_mod" => match find_target(&state, &profile, &action.target).await? {
            Some(Installed::Profile(m)) => {
                let mod_id = m.id;
                pm.set_mod_enabled(profile_id, mod_id, false).await?;
                Ok(ApplyOutcome::Applied { fix: AppliedFix::Disable { profile_id, mod_id } })
            }
            Some(Installed::Sync(entry)) if entry.is_switched_on() => {
                Ok(ApplyOutcome::Applied { fix: set_sync_exclusion(&state, profile_id, &entry, true).await? })
            }
            _ => Ok(skip(&action.target)),
        },

        "enable_mod" => match find_target(&state, &profile, &action.target).await? {
            Some(Installed::Profile(m)) if !m.enabled => {
                let mod_id = m.id;
                pm.set_mod_enabled(profile_id, mod_id, true).await?;
                Ok(ApplyOutcome::Applied { fix: AppliedFix::Enable { profile_id, mod_id } })
            }
            Some(Installed::Sync(entry)) if entry.status == ProfileSyncModStatus::ExcludedHere => {
                Ok(ApplyOutcome::Applied { fix: set_sync_exclusion(&state, profile_id, &entry, false).await? })
            }
            _ => Ok(skip(&action.target)),
        },

        "update_loader" => {
            let target = match &action.target_version {
                Some(v) => v.clone(),
                None => return Ok(skip(&action.target)),
            };
            // Use the per-loader OVERRIDE (highest priority) — setting loader_version alone is
            // outranked by a pack policy or an existing override. Mirrors saveLoaderVersion.
            let loader_key = profile.loader.as_str().to_string();
            let s = &profile.settings;
            let prev_use_overwrite = s.use_overwrite_loader_version;
            let prev_legacy = s.overwrite_loader_version.clone();
            let prev_map = s.overwrite_loader_versions.get(&loader_key).cloned();

            let mut p = profile.clone();
            p.settings.use_overwrite_loader_version = true;
            p.settings.overwrite_loader_version = None;
            p.settings.overwrite_loader_versions.insert(loader_key.clone(), target);
            pm.update_profile(profile_id, p).await?;
            Ok(ApplyOutcome::Applied {
                fix: AppliedFix::Loader { profile_id, loader_key, prev_use_overwrite, prev_legacy, prev_map },
            })
        }

        "update_mod" => {
            let m = match find_target(&state, &profile, &action.target).await? {
                Some(Installed::Profile(m)) => m,
                Some(Installed::Sync(entry)) => {
                    let Some((mod_id, versions)) = sync_mod_versions(&entry, &loader).await? else {
                        return Ok(skip(&action.target));
                    };
                    let target = match pick_update_target(&versions, action.target_version.as_deref(), &mc) {
                        Some(v) if entry.version_id.as_deref() != Some(v.id.as_str()) => v,
                        _ => return Ok(skip(&action.target)),
                    };
                    let pin = pin_sync_version(&state, &profile, &entry, mod_id, &target.id).await?;
                    return Ok(ApplyOutcome::Applied {
                        fix: AppliedFix::Conflict { profile_id, mods: Vec::new(), sync_pins: vec![pin] },
                    });
                }
                None => return Ok(skip(&action.target)),
            };
            // platform from the installed mod's source (Modrinth or CurseForge); skip local/url mods
            let (platform, project_id, current_id) = match mod_platform_ids(&m.source) {
                Some(t) => t,
                None => return Ok(skip(&action.target)),
            };
            let mod_id = m.id;
            let versions = unified_versions(platform, &project_id, &loader).await?;
            // capture the current version so the update stays reversible
            let prev = match versions.iter().find(|v| v.id == current_id) {
                Some(v) => v.clone(),
                None => return Ok(skip(&action.target)),
            };
            let target = match pick_update_target(&versions, action.target_version.as_deref(), &mc) {
                Some(v) => v.clone(),
                None => return Ok(skip(&action.target)),
            };
            pm.update_mod_to_unified_version(profile_id, mod_id, &target).await?;
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Modver { profile_id, mod_id, prev } })
        }

        "install_mod" => {
            // a "missing" dep may actually be present but disabled -> re-enable instead of duplicating
            match find_target(&state, &profile, &action.target).await? {
                Some(Installed::Profile(existing)) => {
                    let mod_id = existing.id;
                    if existing.enabled {
                        return Ok(skip(&action.target)); // already installed & active
                    }
                    pm.set_mod_enabled(profile_id, mod_id, true).await?;
                    return Ok(ApplyOutcome::Applied { fix: AppliedFix::Enable { profile_id, mod_id } });
                }
                Some(Installed::Sync(entry)) if entry.is_switched_on() => return Ok(skip(&action.target)),
                Some(Installed::Sync(entry)) if entry.status == ProfileSyncModStatus::ExcludedHere => {
                    return Ok(ApplyOutcome::Applied { fix: set_sync_exclusion(&state, profile_id, &entry, false).await? });
                }
                _ => {}
            }
            let v = match resolve_version(&action.target, &mc, &loader, action.target_version.as_deref()).await? {
                Some(v) => v,
                None => return Ok(skip(&action.target)),
            };
            let f = v.files.iter().find(|f| f.primary).or_else(|| v.files.first())
                .ok_or_else(|| AppError::Other(format!("Modrinth version {} has no file", v.id)))?;
            pm.add_modrinth_mod(
                profile_id,
                v.project_id.clone(),
                v.id.clone(),
                f.filename.clone(),
                f.url.clone(),
                f.hashes.sha1.clone(),
                Some(action.target.clone()),
                Some(v.version_number.clone()),
                Some(vec![loader.clone()]),
                Some(vec![mc.clone()]),
                true,
            ).await?;
            // find the just-added instance to make the install reversible
            let fresh = pm.get_profile(profile_id).await?;
            match fresh.mods.iter().find(|m| matches!(&m.source, ModSource::Modrinth { version_id, .. } if *version_id == v.id)) {
                Some(m) => Ok(ApplyOutcome::Applied { fix: AppliedFix::Install { profile_id, new_mod_id: m.id } }),
                None => Ok(skip(&action.target)),
            }
        }

        "resolve_conflict" => {
            let targets = action.targets.clone().unwrap_or_default();
            let downgrade = action.direction.as_deref() == Some("downgrade");
            let mut reverts: Vec<ConflictRevert> = Vec::new();
            let mut sync_pins: Vec<SyncPinRevert> = Vec::new();
            for tname in &targets {
                let m = match find_target(&state, &profile, tname).await? {
                    Some(Installed::Profile(m)) => m,
                    Some(Installed::Sync(entry)) => {
                        let Some(current_id) = entry.version_id.clone() else { continue };
                        let Some((mod_id, versions)) = sync_mod_versions(&entry, &loader).await? else { continue };
                        let mc_versions: Vec<UnifiedVersion> =
                            versions.into_iter().filter(|v| v.game_versions.contains(&mc)).collect();
                        let target_v = match pick_directional(&mc_versions, &current_id, downgrade) {
                            Some(v) if v.id != current_id => v,
                            _ => continue,
                        };
                        sync_pins.push(pin_sync_version(&state, &profile, &entry, mod_id, &target_v.id).await?);
                        continue;
                    }
                    None => continue,
                };
                // platform from the installed mod's source; only managed Modrinth/CurseForge mods can be re-versioned
                let (platform, project_id, current_id) = match mod_platform_ids(&m.source) {
                    Some(t) => t,
                    None => continue,
                };
                let mod_id = m.id;
                let versions = unified_versions(platform, &project_id, &loader).await?;
                let prev = match versions.iter().find(|v| v.id == current_id) {
                    Some(v) => v.clone(),
                    None => continue,
                };
                // only MC-compatible builds, else an upgrade could jump to a version that dropped this MC
                let mc_versions: Vec<UnifiedVersion> =
                    versions.into_iter().filter(|v| v.game_versions.contains(&mc)).collect();
                let target_v = match pick_directional(&mc_versions, &current_id, downgrade) {
                    Some(v) if v.id != current_id => v,
                    _ => continue, // already at the edge / no change
                };
                pm.update_mod_to_unified_version(profile_id, mod_id, &target_v).await?;
                reverts.push(ConflictRevert { mod_id, prev });
            }
            if reverts.is_empty() && sync_pins.is_empty() {
                return Ok(skip(&action.target));
            }
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Conflict { profile_id, mods: reverts, sync_pins } })
        }

        "enable_norisk_mod" | "disable_norisk_mod" => {
            let disabled = action.action_type == "disable_norisk_mod";
            let pack_id = match &profile.selected_norisk_pack_id {
                Some(p) => p.clone(),
                None => return Ok(skip(&action.target)), // no NoRisk pack selected
            };
            let mod_id = action.target.clone();
            let gv = profile.game_version.clone();
            let loader = profile.loader.clone();
            let ident = NoriskModIdentifier {
                pack_id: pack_id.clone(),
                mod_id: mod_id.clone(),
                game_version: gv.clone(),
                loader: loader.clone(),
            };
            let prev_disabled = profile.disabled_norisk_mods_detailed.contains(&ident);
            pm.set_norisk_mod_status(profile_id, pack_id.clone(), mod_id.clone(), gv.clone(), loader.clone(), disabled).await?;
            let _ = state.event_state.trigger_profile_update(profile_id).await; // refresh NoRiskModsTab
            Ok(ApplyOutcome::Applied {
                fix: AppliedFix::NoriskMod { profile_id, pack_id, mod_id, game_version: gv, loader, prev_disabled },
            })
        }

        "switch_pack" => {
            let target = action.target.clone();
            let prev_pack_id = profile.selected_norisk_pack_id.clone();
            if prev_pack_id.as_deref() == Some(target.as_str())
                || !state.norisk_pack_manager.get_config().await.packs.contains_key(&target)
            {
                return Ok(skip(&target));
            }
            let mut p = profile.clone();
            p.selected_norisk_pack_id = Some(target);
            pm.update_profile(profile_id, p).await?;
            let _ = state.event_state.trigger_profile_update(profile_id).await;
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Pack { profile_id, prev_pack_id } })
        }

        "repair_profile" => {
            crate::utils::repair_utils::repair_profile(profile_id).await?;
            let _ = state.event_state.trigger_profile_update(profile_id).await;
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Repair { profile_id } })
        }

        other => Ok(skip(other)),
    }
}

#[tauri::command]
pub async fn revert_crash_fix(applied: AppliedFix) -> Result<(), CommandError> {
    let state = State::get().await?;
    let pm = &state.profile_manager;
    match applied {
        AppliedFix::Disable { profile_id, mod_id } => {
            pm.set_mod_enabled(profile_id, mod_id, true).await?;
        }
        AppliedFix::Enable { profile_id, mod_id } => {
            pm.set_mod_enabled(profile_id, mod_id, false).await?;
        }
        AppliedFix::NoriskMod { profile_id, pack_id, mod_id, game_version, loader, prev_disabled } => {
            pm.set_norisk_mod_status(profile_id, pack_id, mod_id, game_version, loader, prev_disabled).await?;
            let _ = state.event_state.trigger_profile_update(profile_id).await; // refresh NoRiskModsTab
        }
        AppliedFix::Install { profile_id, new_mod_id } => {
            pm.delete_mod(profile_id, new_mod_id).await?;
        }
        AppliedFix::Loader { profile_id, loader_key, prev_use_overwrite, prev_legacy, prev_map } => {
            let mut p = pm.get_profile(profile_id).await?;
            p.settings.use_overwrite_loader_version = prev_use_overwrite;
            p.settings.overwrite_loader_version = prev_legacy;
            match prev_map {
                Some(v) => { p.settings.overwrite_loader_versions.insert(loader_key, v); }
                None => { p.settings.overwrite_loader_versions.remove(&loader_key); }
            }
            pm.update_profile(profile_id, p).await?;
        }
        AppliedFix::Modver { profile_id, mod_id, prev } => {
            pm.update_mod_to_unified_version(profile_id, mod_id, &prev).await?;
        }
        AppliedFix::Conflict { profile_id, mods, sync_pins } => {
            for r in mods {
                pm.update_mod_to_unified_version(profile_id, r.mod_id, &r.prev).await?;
            }
            for pin in sync_pins {
                pin.set(&state, pin.prev.clone()).await?;
            }
        }
        AppliedFix::SyncExclusion { profile_id, pack_id, mod_key, excluded } => {
            state.sync_pack_manager.set_profile_exclusions(profile_id, &[(pack_id, mod_key)], !excluded).await?;
        }
        AppliedFix::Pack { profile_id, prev_pack_id } => {
            let mut p = pm.get_profile(profile_id).await?;
            p.selected_norisk_pack_id = prev_pack_id;
            pm.update_profile(profile_id, p).await?;
            let _ = state.event_state.trigger_profile_update(profile_id).await;
        }
        AppliedFix::Repair { profile_id } => {
            log::info!("Repair of profile {} is not revertible; nothing to undo.", profile_id);
        }
    }
    Ok(())
}
