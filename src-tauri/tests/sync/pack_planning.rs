use chrono::Utc;
use noriskclient_launcher_v3_lib::sync::engine::build_plan;
use noriskclient_launcher_v3_lib::sync::model::{
    AdoptStrategy, SyncPack, SyncTarget, SyncTargetKind,
};
use std::collections::HashSet;
use uuid::Uuid;

fn pack(name: &str, targets: Vec<SyncTarget>) -> SyncPack {
    SyncPack {
        id: Uuid::new_v4(),
        name: name.to_string(),
        description: None,
        icon: None,
        enabled: true,
        sort_order: 0,
        created: Utc::now(),
        updated: Utc::now(),
        targets,
        mods: Vec::new(),
    }
}

fn target(path: &str, kind: SyncTargetKind) -> SyncTarget {
    SyncTarget {
        id: Uuid::new_v4(),
        path: path.to_string(),
        enabled: true,
        kind,
        external_path: None,
    }
}

fn linked(path: &str) -> SyncTarget {
    target(
        path,
        SyncTargetKind::DirLink {
            adopt: AdoptStrategy::default(),
        },
    )
}

fn copied(path: &str) -> SyncTarget {
    target(path, SyncTargetKind::FileCopy)
}

fn planned_paths(plan: &noriskclient_launcher_v3_lib::sync::engine::Plan) -> HashSet<String> {
    plan.packs
        .iter()
        .flat_map(|p| p.targets.iter())
        .filter(|t| !t.implicit)
        .map(|t| t.target.path.clone())
        .collect()
}

#[test]
fn two_packs_that_want_the_same_folder_do_not_both_sync_it() {
    let mine = pack("Mine", vec![linked("saves")]);
    let theirs = pack("Theirs", vec![linked("saves")]);

    let plan = build_plan(vec![mine.clone(), theirs.clone()], false);

    let saves: Vec<_> = plan
        .packs
        .iter()
        .flat_map(|p| p.targets.iter().map(move |t| (&p.pack, t)))
        .filter(|(_, t)| t.target.path == "saves")
        .collect();
    assert_eq!(saves.len(), 1, "only one pack may own a folder");

    assert_eq!(plan.conflicts.len(), 1, "the player must be told");
    let clash = &plan.conflicts[0];
    assert_eq!(clash.path, "saves");
    let named: HashSet<&str> = [clash.winner_pack_name.as_str(), clash.loser_pack_name.as_str()]
        .into_iter()
        .collect();
    assert_eq!(named, HashSet::from(["Mine", "Theirs"]));
}

#[test]
fn the_same_packs_always_produce_the_same_winner() {
    let mine = pack("Mine", vec![linked("saves")]);
    let theirs = pack("Theirs", vec![linked("saves")]);
    let third = pack("Third", vec![linked("saves")]);

    let first = build_plan(vec![mine.clone(), theirs.clone(), third.clone()], false);
    let expected = first.conflicts[0].winner_pack_id;

    for run in 0..200 {
        let again = build_plan(vec![mine.clone(), theirs.clone(), third.clone()], false);
        assert_eq!(
            again.conflicts[0].winner_pack_id, expected,
            "run {run} picked a different winner; the player would see their folder move between launches"
        );
    }
}

#[test]
fn a_pack_i_turned_off_takes_no_part_at_all() {
    let mut off = pack("Off", vec![linked("saves")]);
    off.enabled = false;
    let on = pack("On", vec![linked("resourcepacks")]);

    let plan = build_plan(vec![off, on], false);

    assert_eq!(planned_paths(&plan), HashSet::from(["resourcepacks".to_string()]));
    assert!(plan.conflicts.is_empty(), "a pack that is off cannot clash");
}

#[test]
fn a_target_i_turned_off_inside_a_pack_is_left_out() {
    let mut targets = vec![linked("saves"), linked("resourcepacks")];
    targets[0].enabled = false;

    let plan = build_plan(vec![pack("Mine", targets)], false);

    assert_eq!(planned_paths(&plan), HashSet::from(["resourcepacks".to_string()]));
}

#[test]
fn a_linked_folder_shadows_a_file_another_pack_puts_inside_it() {
    let folder = pack("Folder", vec![linked("saves")]);
    let single = pack("Single", vec![copied("saves/world/level.dat")]);

    let plan = build_plan(vec![folder, single], false);

    assert_eq!(
        planned_paths(&plan),
        HashSet::from(["saves".to_string()]),
        "a file inside a linked folder cannot be synced separately"
    );
    assert_eq!(plan.conflicts.len(), 1);
    assert_eq!(plan.conflicts[0].path, "saves/world/level.dat");
    assert_eq!(plan.conflicts[0].winner_pack_name, "Folder");
    assert_eq!(plan.conflicts[0].loser_pack_name, "Single");
}

#[test]
fn packs_that_want_different_folders_both_run() {
    let worlds = pack("Worlds", vec![linked("saves")]);
    let looks = pack("Looks", vec![linked("resourcepacks")]);

    let plan = build_plan(vec![worlds, looks], false);

    assert_eq!(
        planned_paths(&plan),
        HashSet::from(["saves".to_string(), "resourcepacks".to_string()])
    );
    assert!(plan.conflicts.is_empty());
}

#[test]
fn every_pack_contributes_its_mods_when_the_game_starts() {
    let plan = build_plan(vec![pack("Mine", vec![linked("saves")])], true);

    let mods: Vec<_> = plan.packs[0]
        .targets
        .iter()
        .filter(|t| matches!(t.target.kind, SyncTargetKind::Mods))
        .collect();
    assert_eq!(mods.len(), 1, "a pack's mods must reach the game");
}

#[test]
fn nothing_contributes_mods_once_the_game_has_exited() {
    let plan = build_plan(vec![pack("Mine", vec![linked("saves")])], false);

    assert!(
        !plan.packs[0]
            .targets
            .iter()
            .any(|t| matches!(t.target.kind, SyncTargetKind::Mods)),
        "writing back after a session must not pull mods in again"
    );
}

#[test]
fn a_pack_that_already_syncs_mods_does_not_get_a_second_mods_target() {
    let explicit = pack("Mine", vec![target("mods", SyncTargetKind::Mods)]);

    let plan = build_plan(vec![explicit], true);

    let mods = plan.packs[0]
        .targets
        .iter()
        .filter(|t| matches!(t.target.kind, SyncTargetKind::Mods))
        .count();
    assert_eq!(mods, 1);
}
