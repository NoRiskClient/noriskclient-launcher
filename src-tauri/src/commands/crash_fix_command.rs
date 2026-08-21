use crate::error::{AppError, CommandError};
use crate::integrations::modrinth::{self, ModrinthVersion};
use crate::integrations::unified_mod::{self, ModPlatform, UnifiedModVersionsParams, UnifiedVersion};
use crate::state::profile_state::{Mod, ModLoader, ModSource, NoriskModIdentifier, Profile};
use crate::state::state_manager::State;
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
    Conflict { profile_id: Uuid, mods: Vec<ConflictRevert> },
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

/// find the installed mod for a mod-id, preferring the enabled instance (a disabled one isn't the
/// active culprit). None when unsure.
fn find_installed_mod<'a>(profile: &'a Profile, target: &str) -> Option<&'a Mod> {
    let t = norm(target);
    let tl = target.to_lowercase();
    let matches = |m: &&Mod| {
        m.display_name.as_deref().map_or(false, |d| norm(d) == t)
            || source_file_name(m).map_or(false, |f| mod_id_from_file(f) == tl)
            || matches!(&m.source, ModSource::Modrinth { project_id, .. } if norm(project_id) == t)
    };
    profile.mods.iter().find(|m| m.enabled && matches(m)).or_else(|| profile.mods.iter().find(matches))
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

/// (platform, project_id, current version/file id) for a managed Modrinth/CurseForge mod; None for local/url.
fn managed_source(m: &Mod) -> Option<(ModPlatform, String, String)> {
    match &m.source {
        ModSource::Modrinth { project_id, version_id, .. } => Some((ModPlatform::Modrinth, project_id.clone(), version_id.clone())),
        ModSource::CurseForge { project_id, file_id, .. } => Some((ModPlatform::CurseForge, project_id.clone(), file_id.clone())),
        _ => None,
    }
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
        "disable_mod" => match find_installed_mod(&profile, &action.target) {
            Some(m) => {
                let mod_id = m.id;
                pm.set_mod_enabled(profile_id, mod_id, false).await?;
                Ok(ApplyOutcome::Applied { fix: AppliedFix::Disable { profile_id, mod_id } })
            }
            None => Ok(skip(&action.target)),
        },

        "enable_mod" => match find_installed_mod(&profile, &action.target) {
            Some(m) if !m.enabled => {
                let mod_id = m.id;
                pm.set_mod_enabled(profile_id, mod_id, true).await?;
                Ok(ApplyOutcome::Applied { fix: AppliedFix::Enable { profile_id, mod_id } })
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
            let m = match find_installed_mod(&profile, &action.target) {
                Some(m) => m,
                None => return Ok(skip(&action.target)),
            };
            // platform from the installed mod's source (Modrinth or CurseForge); skip local/url mods
            let (platform, project_id, current_id) = match managed_source(m) {
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
            // target: an explicit version_number wins, else the newest version compatible with this MC
            let want = action.target_version.as_deref();
            let target = want
                .and_then(|w| versions.iter().find(|v| v.version_number == w || v.version_number.starts_with(w)))
                .or_else(|| versions.iter().filter(|v| v.game_versions.contains(&mc)).max_by(|a, b| a.date_published.cmp(&b.date_published)))
                .or_else(|| versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)));
            let target = match target {
                Some(v) => v.clone(),
                None => return Ok(skip(&action.target)),
            };
            pm.update_mod_to_unified_version(profile_id, mod_id, &target).await?;
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Modver { profile_id, mod_id, prev } })
        }

        "install_mod" => {
            // a "missing" dep may actually be present but disabled -> re-enable instead of duplicating
            if let Some(existing) = find_installed_mod(&profile, &action.target) {
                let mod_id = existing.id;
                if existing.enabled {
                    return Ok(skip(&action.target)); // already installed & active
                }
                pm.set_mod_enabled(profile_id, mod_id, true).await?;
                return Ok(ApplyOutcome::Applied { fix: AppliedFix::Enable { profile_id, mod_id } });
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
            for tname in &targets {
                let m = match find_installed_mod(&profile, tname) {
                    Some(m) => m,
                    None => continue,
                };
                // platform from the installed mod's source; only managed Modrinth/CurseForge mods can be re-versioned
                let (platform, project_id, current_id) = match managed_source(m) {
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
            if reverts.is_empty() {
                return Ok(skip(&action.target));
            }
            Ok(ApplyOutcome::Applied { fix: AppliedFix::Conflict { profile_id, mods: reverts } })
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
        AppliedFix::Conflict { profile_id, mods } => {
            for r in mods {
                pm.update_mod_to_unified_version(profile_id, r.mod_id, &r.prev).await?;
            }
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
