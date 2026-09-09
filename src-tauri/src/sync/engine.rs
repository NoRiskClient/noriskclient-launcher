use crate::error::Result;
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use crate::state::sync_pack_state::PACK_LOCK_TIMEOUT;
use crate::sync::context::SyncContext;
use crate::sync::handlers::{handler_for, SyncHandler};
use crate::sync::model::{DetachMode, SyncPack, SyncTarget, SyncTargetKind};
use crate::sync::paths;
use crate::sync::report::{
    HandlerOutcome, LaunchSyncResult, SyncConflict, SyncPackResult, SyncPreviewEntry, SyncReport,
    SyncTargetResult,
};
use crate::sync::subscribers;
use log::{debug, info, warn};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    PreLaunch,
    PostExit,
    Detach(DetachMode),
}

pub struct PlannedTarget {
    pub target: SyncTarget,
    pub implicit: bool,
}

pub struct PlannedPack {
    pub pack: SyncPack,
    pub targets: Vec<PlannedTarget>,
}

pub struct Plan {
    pub packs: Vec<PlannedPack>,
    pub conflicts: Vec<SyncConflict>,
    pub linked_dirs: HashSet<String>,
}

fn conflict_between(
    path: String,
    winner_pack: &SyncPack,
    winner: &SyncTarget,
    loser_pack: &SyncPack,
    loser: &SyncTarget,
) -> SyncConflict {
    SyncConflict {
        path,
        winner_pack_id: winner_pack.id,
        winner_pack_name: winner_pack.name.clone(),
        winner_kind: winner.kind.discriminant().to_string(),
        loser_pack_id: loser_pack.id,
        loser_pack_name: loser_pack.name.clone(),
        loser_kind: loser.kind.discriminant().to_string(),
    }
}

pub fn build_plan(packs: Vec<SyncPack>, with_implicit_mods: bool) -> Plan {
    let enabled: Vec<SyncPack> = packs.into_iter().filter(|p| p.enabled).collect();

    let mut entries: Vec<(usize, usize)> = Vec::new();
    for (pack_index, pack) in enabled.iter().enumerate() {
        for (target_index, target) in pack.targets.iter().enumerate() {
            if target.enabled {
                entries.push((pack_index, target_index));
            }
        }
    }

    let target_at = |pack_index: usize, target_index: usize| -> &SyncTarget {
        &enabled[pack_index].targets[target_index]
    };

    let mut winner_by_path: HashMap<String, (usize, usize)> = HashMap::new();
    let mut conflicts: Vec<SyncConflict> = Vec::new();

    for (pack_index, target_index) in &entries {
        let target = target_at(*pack_index, *target_index);
        for claim in target.claimed_paths() {
            if let Some((prev_pack, prev_target)) =
                winner_by_path.insert(claim.clone(), (*pack_index, *target_index))
            {
                conflicts.push(conflict_between(
                    claim,
                    &enabled[*pack_index],
                    target,
                    &enabled[prev_pack],
                    target_at(prev_pack, prev_target),
                ));
            }
        }
    }

    let linked_dirs: HashSet<String> = winner_by_path
        .iter()
        .filter(|(_, (p, t))| target_at(*p, *t).kind.is_dir_link())
        .map(|(path, _)| path.clone())
        .collect();

    let shadowed: Vec<(String, String)> = winner_by_path
        .keys()
        .filter_map(|path| {
            linked_dirs
                .iter()
                .find(|dir| dir.as_str() != path.as_str() && path.starts_with(&format!("{}/", dir)))
                .map(|dir| (path.clone(), dir.clone()))
        })
        .collect();

    for (path, dir) in shadowed {
        let Some((loser_pack, loser_target)) = winner_by_path.remove(&path) else {
            continue;
        };
        let Some((winner_pack, winner_target)) = winner_by_path.get(&dir).copied() else {
            continue;
        };
        conflicts.push(conflict_between(
            path,
            &enabled[winner_pack],
            target_at(winner_pack, winner_target),
            &enabled[loser_pack],
            target_at(loser_pack, loser_target),
        ));
    }

    let mut kept: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut keep = |pack_index: usize, target_index: usize| {
        let list = kept.entry(pack_index).or_insert_with(Vec::new);
        if !list.contains(&target_index) {
            list.push(target_index);
        }
    };

    for (pack_index, target_index) in &entries {
        if enabled[*pack_index].targets[*target_index]
            .claimed_paths()
            .is_empty()
        {
            keep(*pack_index, *target_index);
        }
    }
    for (pack_index, target_index) in winner_by_path.values() {
        keep(*pack_index, *target_index);
    }

    let mut planned = Vec::new();
    for (pack_index, pack) in enabled.into_iter().enumerate() {
        let mut indices = kept.remove(&pack_index).unwrap_or_default();
        indices.sort_unstable();

        let mut targets: Vec<PlannedTarget> = indices
            .into_iter()
            .filter_map(|i| pack.targets.get(i).cloned())
            .map(|target| PlannedTarget {
                target,
                implicit: false,
            })
            .collect();

        if with_implicit_mods
            && !targets
                .iter()
                .any(|planned| matches!(planned.target.kind, SyncTargetKind::Mods))
        {
            targets.push(PlannedTarget {
                target: SyncTarget {
                    id: pack.id,
                    path: "mods".to_string(),
                    enabled: true,
                    kind: SyncTargetKind::Mods,
                    external_path: None,
                },
                implicit: true,
            });
        }

        planned.push(PlannedPack { pack, targets });
    }

    Plan {
        packs: planned,
        conflicts,
        linked_dirs,
    }
}

async fn run_handler(
    handler: &'static dyn SyncHandler,
    ctx: &SyncContext<'_>,
    phase: Phase,
) -> Result<HandlerOutcome> {
    match phase {
        Phase::PreLaunch => handler.apply_pre_launch(ctx).await,
        Phase::PostExit => handler.write_back_post_exit(ctx).await,
        Phase::Detach(mode) => handler.detach(ctx, mode).await,
    }
}

pub struct SyncEngine;

impl SyncEngine {
    async fn run(
        profile: &Profile,
        pack_ids: &[Uuid],
        phase: Phase,
    ) -> Result<LaunchSyncResult> {
        Self::run_scoped(profile, pack_ids, phase, None).await
    }

    async fn run_scoped(
        profile: &Profile,
        pack_ids: &[Uuid],
        phase: Phase,
        only_target: Option<Uuid>,
    ) -> Result<LaunchSyncResult> {
        let mut result = LaunchSyncResult::default();
        result.report.profile_id = Some(profile.id);

        if pack_ids.is_empty() {
            return Ok(result);
        }

        if paths::is_temp_profile_path(&profile.path) {
            debug!(
                "Skipping sync packs for the temporary profile '{}'",
                profile.name
            );
            return Ok(result);
        }
        let state = State::get().await?;
        if !state.sync_pack_manager.is_available().await {
            result
                .report
                .warnings
                .push("The launcher database is not available, sync packs were skipped".to_string());
            return Ok(result);
        }

        let instance_dir = state
            .profile_manager
            .calculate_instance_path_for_profile(profile)?;
        tokio::fs::create_dir_all(&instance_dir).await?;

        let packs = state.sync_pack_manager.get_packs(pack_ids).await?;
        let plan = build_plan(packs, matches!(phase, Phase::PreLaunch));
        result.report.conflicts = plan.conflicts;

        for planned in &plan.packs {
            let pack = &planned.pack;
            let mut pack_result = SyncPackResult {
                pack_id: pack.id,
                pack_name: pack.name.clone(),
                skipped: false,
                targets: Vec::new(),
            };

            let lock = state.sync_pack_manager.lock_for(pack.id);
            let guard = match tokio::time::timeout(PACK_LOCK_TIMEOUT, lock.lock()).await {
                Ok(guard) => guard,
                Err(_) => {
                    warn!(
                        "Sync pack '{}' is busy, skipping it for profile '{}'",
                        pack.name, profile.name
                    );
                    pack_result.skipped = true;
                    result
                        .report
                        .warnings
                        .push(format!("Sync pack '{}' is busy and was skipped", pack.name));
                    result.report.packs.push(pack_result);
                    continue;
                }
            };

            if let Err(e) = paths::ensure_pack_dirs(pack.id).await {
                warn!(
                    "Could not prepare folders for sync pack '{}': {}",
                    pack.name, e
                );
                pack_result.skipped = true;
                result.report.packs.push(pack_result);
                drop(guard);
                continue;
            }

            let all = subscribers::of_pack(&state, pack.id).await;
            let instances = subscribers::unique_instances(&all);
            let shared = match phase {
                Phase::Detach(_) => subscribers::shares_instance_with_other(
                    &all,
                    profile.id,
                    &subscribers::canonical_of(&instance_dir).await,
                ),
                _ => false,
            };

            for planned_target in &planned.targets {
                let target = &planned_target.target;
                if only_target.is_some_and(|wanted| target.id != wanted) {
                    continue;
                }
                let ctx = SyncContext::new(
                    pack,
                    target,
                    profile,
                    &instance_dir,
                    &instances,
                    &plan.linked_dirs,
                    shared,
                    &state,
                );

                let mut target_result = SyncTargetResult {
                    target_path: target.path.clone(),
                    kind: target.kind.discriminant().to_string(),
                    ..Default::default()
                };

                match run_handler(handler_for(&target.kind), &ctx, phase).await {
                    Ok(outcome) => {
                        target_result.changed = outcome.changed;
                        target_result.messages = outcome.messages;
                        target_result.warnings = outcome.warnings;
                        result.extra_mods.extend(outcome.extra_mods);
                        result.extra_local_jars.extend(outcome.extra_local_jars);
                    }
                    Err(e) => {
                        warn!(
                            "Sync target '{}' of pack '{}' failed: {}",
                            target.path, pack.name, e
                        );
                        target_result.error = Some(e.to_string());
                    }
                }

                if planned_target.implicit && !target_result.reports_anything() {
                    continue;
                }
                pack_result.targets.push(target_result);
            }

            drop(guard);
            result.report.packs.push(pack_result);
        }

        Ok(result)
    }

    async fn run_for_profile(
        profile_id: Uuid,
        pack_ids: Option<&[Uuid]>,
        phase: Phase,
    ) -> Result<SyncReport> {
        let state = State::get().await?;
        let profile = state.profile_manager.get_profile(profile_id).await?;
        let ids = match pack_ids {
            Some(ids) => ids.to_vec(),
            None => profile.sync_pack_ids.clone(),
        };
        Ok(Self::run(&profile, &ids, phase).await?.report)
    }

    pub async fn prepare_for_launch(profile: &Profile) -> Result<LaunchSyncResult> {
        let ids = profile.sync_pack_ids.clone();
        let result = Self::run(profile, &ids, Phase::PreLaunch).await?;
        if !result.report.is_empty() {
            info!(
                "Sync packs prepared for '{}': {} target(s) changed, {} conflict(s)",
                profile.name,
                result.report.changed_targets(),
                result.report.conflicts.len()
            );
        }
        Ok(result)
    }

    pub async fn write_back_after_exit(profile_id: Uuid) -> Result<SyncReport> {
        Self::run_for_profile(profile_id, None, Phase::PostExit).await
    }

    pub async fn detach_pack_from_profile(
        pack_id: Uuid,
        profile_id: Uuid,
        mode: DetachMode,
    ) -> Result<SyncReport> {
        Self::run_for_profile(profile_id, Some(&[pack_id]), Phase::Detach(mode)).await
    }

    pub async fn detach_packs_from_profile(
        pack_ids: &[Uuid],
        profile_id: Uuid,
        mode: DetachMode,
    ) -> Result<SyncReport> {
        Self::run_for_profile(profile_id, Some(pack_ids), Phase::Detach(mode)).await
    }

    pub async fn detach_target_from_subscribers(
        pack_id: Uuid,
        target_id: Uuid,
        mode: DetachMode,
    ) -> Result<usize> {
        let state = State::get().await?;
        let mut detached = 0usize;

        for subscriber in subscribers::of_pack(&state, pack_id).await {
            let name = subscriber.profile.name.clone();
            match Self::run_scoped(
                &subscriber.profile,
                &[pack_id],
                Phase::Detach(mode),
                Some(target_id),
            )
            .await
            {
                Ok(result) if result.report.changed_targets() > 0 => detached += 1,
                Ok(_) => {}
                Err(e) => warn!(
                    "Could not release the shared folder from profile '{}': {}",
                    name, e
                ),
            }
        }

        Ok(detached)
    }

    pub async fn detach_all(profile_id: Uuid, mode: DetachMode) -> Result<SyncReport> {
        let report = Self::run_for_profile(profile_id, None, Phase::Detach(mode)).await?;
        let state = State::get().await?;
        let _ = state
            .sync_pack_manager
            .clear_adoptions_for_profile(profile_id)
            .await;
        Ok(report)
    }

    pub async fn preview(profile: &Profile, pack_ids: &[Uuid]) -> Result<Vec<SyncPreviewEntry>> {
        if paths::is_temp_profile_path(&profile.path) {
            return Ok(Vec::new());
        }

        let state = State::get().await?;
        let instance_dir = state
            .profile_manager
            .calculate_instance_path_for_profile(profile)?;
        let packs = state.sync_pack_manager.get_packs(pack_ids).await?;
        let plan = build_plan(packs, false);

        let mut out = Vec::new();
        for planned in &plan.packs {
            let instances =
                subscribers::unique_instances(&subscribers::of_pack(&state, planned.pack.id).await);
            for planned_target in &planned.targets {
                let ctx = SyncContext::new(
                    &planned.pack,
                    &planned_target.target,
                    profile,
                    &instance_dir,
                    &instances,
                    &plan.linked_dirs,
                    false,
                    &state,
                );
                if let Some(entry) = handler_for(&planned_target.target.kind).preview(&ctx).await {
                    out.push(entry);
                }
            }
        }

        Ok(out)
    }

    pub async fn detect_conflicts(profile: &Profile) -> Result<Vec<SyncConflict>> {
        let state = State::get().await?;
        let packs = state
            .sync_pack_manager
            .get_packs(&profile.sync_pack_ids)
            .await?;
        Ok(build_plan(packs, false).conflicts)
    }
}
