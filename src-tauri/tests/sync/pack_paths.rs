use noriskclient_launcher_v3_lib::sync::model::{AdoptStrategy, SyncTargetKind};
use noriskclient_launcher_v3_lib::sync::paths;
use std::path::Path;
use uuid::Uuid;

fn dir_link() -> SyncTargetKind {
    SyncTargetKind::DirLink {
        adopt: AdoptStrategy::default(),
    }
}

fn allowed(path: &str) -> String {
    paths::validate_target_path(path, &dir_link())
        .unwrap_or_else(|e| panic!("a pack should be allowed to share '{path}': {e}"))
}

fn refused(path: &str) {
    assert!(
        paths::validate_target_path(path, &dir_link()).is_err(),
        "a pack must not be able to claim '{path}'"
    );
}

#[test]
fn a_pack_may_share_the_folders_a_player_cares_about() {
    assert_eq!(allowed("saves"), "saves");
    assert_eq!(allowed("resourcepacks"), "resourcepacks");
    assert_eq!(allowed("shaderpacks"), "shaderpacks");
    assert_eq!(allowed("config/sodium"), "config/sodium");
    assert_eq!(allowed("options.txt"), "options.txt");
}

#[test]
fn a_pack_cannot_take_over_what_the_launcher_installs() {
    refused("mods");
    refused("versions");
    refused("libraries");
    refused("assets");
    refused("mods/sodium.jar");
}

#[test]
fn spelling_the_name_differently_does_not_get_a_pack_past_the_guard() {
    refused("Mods");
    refused("MODS");
    refused("Libraries");
}

#[test]
fn a_pack_that_syncs_its_own_mod_list_is_still_allowed_to_say_mods() {
    assert_eq!(
        paths::validate_target_path("mods", &SyncTargetKind::Mods).unwrap(),
        "mods",
        "the mods target is the pack's own list, not the launcher's folder"
    );
}

#[test]
fn a_pack_cannot_reach_outside_the_instance() {
    refused("../saves");
    refused("saves/../../elsewhere");
    refused("..");
}

#[test]
fn a_path_that_looks_absolute_never_leads_out_of_the_profile() {
    let instance = Path::new("instances").join("my-profile");

    for path in [
        r"C:\Windows\System32",
        "C:/Windows",
        "/etc/passwd",
        r"\\server\share",
    ] {
        let Ok(normalized) = paths::validate_target_path(path, &dir_link()) else {
            continue;
        };

        let target = paths::instance_path_for(&instance, &normalized).unwrap();
        assert!(
            target.starts_with(&instance),
            "'{path}' escaped the profile as {}",
            target.display()
        );
        assert!(
            !Path::new(&normalized).is_absolute(),
            "'{path}' stayed absolute as '{normalized}'"
        );
    }
}

#[test]
fn a_path_with_no_real_name_in_it_is_refused() {
    refused("");
    refused("/");
    refused("///");
    refused(".");
}

#[test]
fn a_windows_style_path_means_the_same_folder_as_the_slash_version() {
    assert_eq!(allowed("config\\sodium"), "config/sodium");
    assert_eq!(allowed("saves\\"), "saves");
    assert_eq!(allowed("config//sodium"), "config/sodium");
}

#[test]
fn folders_the_game_rewrites_are_allowed_but_stay_the_players_choice() {
    assert_eq!(allowed("logs"), "logs");
    assert_eq!(allowed("crash-reports"), "crash-reports");
}

#[test]
fn a_shared_folder_always_lands_inside_its_own_pack() {
    let pack = Uuid::new_v4();
    let master = paths::master_path_for(pack, "saves").unwrap();

    assert!(
        master.starts_with(paths::pack_dir(pack)),
        "a pack must never write outside its own folder, got {}",
        master.display()
    );
    assert!(master.ends_with("saves"));
}

#[test]
fn a_shared_folder_always_lands_inside_the_profile_it_belongs_to() {
    let instance = Path::new("C:\\instances\\my-profile");
    let target = paths::instance_path_for(instance, "config/sodium").unwrap();

    assert!(
        target.starts_with(instance),
        "a target must never escape the profile, got {}",
        target.display()
    );
}

#[test]
fn a_pack_cannot_escape_the_profile_through_the_path_it_stored() {
    let instance = Path::new("C:\\instances\\my-profile");
    assert!(paths::instance_path_for(instance, "../other-profile").is_err());
    assert!(paths::master_path_for(Uuid::new_v4(), "../..").is_err());
}

#[test]
fn two_packs_never_share_a_folder_on_disk() {
    let one = paths::master_path_for(Uuid::new_v4(), "saves").unwrap();
    let two = paths::master_path_for(Uuid::new_v4(), "saves").unwrap();

    assert_ne!(one, two);
}

#[test]
fn a_throwaway_profile_is_recognised_so_it_is_left_out_of_syncing() {
    assert!(paths::is_temp_profile_path("noriskclient/temp/abc"));
    assert!(!paths::is_temp_profile_path("noriskclient/new"));
    assert!(!paths::is_temp_profile_path("my-temp-favourites"));
}
