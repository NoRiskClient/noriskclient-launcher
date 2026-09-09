use noriskclient_launcher_v3_lib::state::db;
use noriskclient_launcher_v3_lib::state::profile_state::{Mod, ModSource};
use noriskclient_launcher_v3_lib::state::sync_pack_state::SyncPackManager;
use noriskclient_launcher_v3_lib::sync::model::{
    AdoptStrategy, SyncTarget, SyncTargetKind, SyncTargetState, VersionOverride,
};
use std::path::PathBuf;
use uuid::Uuid;

struct Store {
    manager: SyncPackManager,
    path: PathBuf,
    _dir: tempfile::TempDir,
}

impl Store {
    async fn open() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        let handle = db::new_handle();
        crate::harness::open_at_for_test(&handle, &path).await;
        Store {
            manager: SyncPackManager::new(handle).unwrap(),
            path,
            _dir: dir,
        }
    }

    async fn restart(&self) -> SyncPackManager {
        let handle = db::new_handle();
        crate::harness::open_at_for_test(&handle, &self.path).await;
        SyncPackManager::new(handle).unwrap()
    }
}

fn linked(path: &str) -> SyncTarget {
    SyncTarget {
        id: Uuid::new_v4(),
        path: path.to_string(),
        enabled: true,
        kind: SyncTargetKind::DirLink {
            adopt: AdoptStrategy::default(),
        },
        external_path: None,
    }
}

fn a_mod(file_name: &str) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: file_name.to_string(),
            version_id: "v1".to_string(),
            file_name: file_name.to_string(),
            download_url: format!("https://example.invalid/{}", file_name),
            file_hash_sha1: None,
        },
        enabled: true,
        display_name: Some(file_name.to_string()),
        version: None,
        game_versions: None,
        file_name_override: None,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: true,
        force_include_versions: Vec::new(),
        extra: Default::default(),
    }
}

#[tokio::test]
async fn a_pack_i_made_is_still_there_after_a_restart() {
    let store = Store::open().await;
    let pack = store
        .manager
        .create_pack("Worlds".to_string(), Some("shared saves".to_string()), None)
        .await
        .unwrap();
    store.manager.upsert_target(pack.id, linked("saves")).await.unwrap();
    store.manager.add_mods(pack.id, &[a_mod("sodium.jar")]).await.unwrap();

    let reopened = store.restart().await;
    let again = reopened.require_pack(pack.id).await.unwrap();

    assert_eq!(again.name, "Worlds");
    assert_eq!(again.description.as_deref(), Some("shared saves"));
    assert_eq!(again.targets.len(), 1);
    assert_eq!(again.targets[0].path, "saves");
    assert_eq!(again.mods.len(), 1);
}

#[tokio::test]
async fn renaming_a_pack_leaves_its_folders_and_mods_alone() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Old".to_string(), None, None).await.unwrap();
    store.manager.upsert_target(pack.id, linked("saves")).await.unwrap();
    store.manager.add_mods(pack.id, &[a_mod("sodium.jar")]).await.unwrap();

    store
        .manager
        .update_pack_meta(pack.id, Some("New".to_string()), None, None, None, None)
        .await
        .unwrap();

    let again = store.manager.require_pack(pack.id).await.unwrap();
    assert_eq!(again.name, "New");
    assert_eq!(again.targets.len(), 1);
    assert_eq!(again.mods.len(), 1);
}

#[tokio::test]
async fn turning_a_pack_off_keeps_everything_it_holds() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    store.manager.upsert_target(pack.id, linked("saves")).await.unwrap();

    store
        .manager
        .update_pack_meta(pack.id, None, None, None, Some(false), None)
        .await
        .unwrap();

    let again = store.manager.require_pack(pack.id).await.unwrap();
    assert!(!again.enabled, "the pack must be off");
    assert_eq!(again.targets.len(), 1, "turning it off must not drop its folders");
}

#[tokio::test]
async fn adding_the_same_folder_twice_does_not_give_me_two_of_them() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();

    let mut target = linked("saves");
    store.manager.upsert_target(pack.id, target.clone()).await.unwrap();
    target.enabled = false;
    store.manager.upsert_target(pack.id, target).await.unwrap();

    let again = store.manager.require_pack(pack.id).await.unwrap();
    assert_eq!(again.targets.len(), 1);
    assert!(!again.targets[0].enabled, "the second add must update the first");
}

#[tokio::test]
async fn taking_one_folder_out_leaves_the_others() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let saves = linked("saves");
    store.manager.upsert_target(pack.id, saves.clone()).await.unwrap();
    store.manager.upsert_target(pack.id, linked("resourcepacks")).await.unwrap();

    store.manager.remove_target(pack.id, saves.id).await.unwrap();

    let again = store.manager.require_pack(pack.id).await.unwrap();
    assert_eq!(again.targets.len(), 1);
    assert_eq!(again.targets[0].path, "resourcepacks");
}

#[tokio::test]
async fn a_folder_the_pack_took_over_is_remembered_after_a_restart() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let profile = Uuid::new_v4();
    store.manager.mark_adopted(pack.id, "saves", profile).await.unwrap();

    let reopened = store.restart().await;

    assert!(
        reopened.is_adopted(pack.id, "saves", profile).await.unwrap(),
        "forgetting this is how a player's files get deleted without a backup"
    );
}

#[tokio::test]
async fn marking_the_same_folder_twice_is_harmless() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let profile = Uuid::new_v4();

    store.manager.mark_adopted(pack.id, "saves", profile).await.unwrap();
    store.manager.mark_adopted(pack.id, "saves", profile).await.unwrap();

    store.manager.clear_adoption(pack.id, "saves", profile).await.unwrap();
    assert!(
        !store.manager.is_adopted(pack.id, "saves", profile).await.unwrap(),
        "one clear must undo it, not leave a second row behind"
    );
}

#[tokio::test]
async fn two_profiles_sharing_a_pack_are_tracked_apart() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let alice = Uuid::new_v4();
    let bob = Uuid::new_v4();
    store.manager.mark_adopted(pack.id, "saves", alice).await.unwrap();
    store.manager.mark_adopted(pack.id, "saves", bob).await.unwrap();

    store.manager.clear_adoption(pack.id, "saves", alice).await.unwrap();

    assert!(!store.manager.is_adopted(pack.id, "saves", alice).await.unwrap());
    assert!(
        store.manager.is_adopted(pack.id, "saves", bob).await.unwrap(),
        "one profile leaving must not affect the other"
    );
}

#[tokio::test]
async fn a_profile_that_goes_away_takes_only_its_own_records() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let leaving = Uuid::new_v4();
    let staying = Uuid::new_v4();
    store.manager.mark_adopted(pack.id, "saves", leaving).await.unwrap();
    store.manager.mark_adopted(pack.id, "resourcepacks", leaving).await.unwrap();
    store.manager.mark_adopted(pack.id, "saves", staying).await.unwrap();

    store.manager.clear_adoptions_for_profile(leaving).await.unwrap();

    assert!(!store.manager.is_adopted(pack.id, "saves", leaving).await.unwrap());
    assert!(!store.manager.is_adopted(pack.id, "resourcepacks", leaving).await.unwrap());
    assert!(store.manager.is_adopted(pack.id, "saves", staying).await.unwrap());
}

#[tokio::test]
async fn taking_a_folder_out_of_the_pack_forgets_it_took_it_over() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let saves = linked("saves");
    let packs_target = linked("resourcepacks");
    store.manager.upsert_target(pack.id, saves.clone()).await.unwrap();
    store.manager.upsert_target(pack.id, packs_target).await.unwrap();

    let profile = Uuid::new_v4();
    store.manager.mark_adopted(pack.id, "saves", profile).await.unwrap();
    store.manager.mark_adopted(pack.id, "resourcepacks", profile).await.unwrap();

    store.manager.remove_target(pack.id, saves.id).await.unwrap();

    assert!(
        !store.manager.is_adopted(pack.id, "saves", profile).await.unwrap(),
        "a stale record would let a later re-add delete the player's files"
    );
    assert!(store.manager.is_adopted(pack.id, "resourcepacks", profile).await.unwrap());
}

#[tokio::test]
async fn deleting_a_pack_forgets_every_folder_it_took_over() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let profile = Uuid::new_v4();
    store.manager.upsert_target(pack.id, linked("saves")).await.unwrap();
    store.manager.mark_adopted(pack.id, "saves", profile).await.unwrap();

    store.manager.delete_pack(pack.id).await.unwrap();

    assert!(!store.manager.is_adopted(pack.id, "saves", profile).await.unwrap());
    assert!(store.manager.get_pack(pack.id).await.unwrap().is_none());
}

#[tokio::test]
async fn deleting_one_pack_leaves_the_other_alone() {
    let store = Store::open().await;
    let gone = store.manager.create_pack("Gone".to_string(), None, None).await.unwrap();
    let kept = store.manager.create_pack("Kept".to_string(), None, None).await.unwrap();
    store.manager.upsert_target(kept.id, linked("saves")).await.unwrap();
    store.manager.add_mods(kept.id, &[a_mod("sodium.jar")]).await.unwrap();

    store.manager.delete_pack(gone.id).await.unwrap();

    let again = store.manager.require_pack(kept.id).await.unwrap();
    assert_eq!(again.targets.len(), 1);
    assert_eq!(again.mods.len(), 1);
}

#[tokio::test]
async fn what_the_launcher_last_wrote_to_a_folder_survives_a_restart() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let source = Uuid::new_v4();

    store
        .manager
        .set_target_state(
            pack.id,
            "saves",
            &SyncTargetState {
                last_sync: Some(1_700_000_000),
                content_sha1: Some("abc123".to_string()),
                last_source_profile: Some(source),
            },
        )
        .await
        .unwrap();

    let reopened = store.restart().await;
    let state = reopened.get_target_state(pack.id, "saves").await.unwrap();

    assert_eq!(state.last_sync, Some(1_700_000_000));
    assert_eq!(state.content_sha1.as_deref(), Some("abc123"));
    assert_eq!(state.last_source_profile, Some(source));
}

#[tokio::test]
async fn a_folder_nobody_synced_yet_reports_a_blank_state() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();

    let state = store.manager.get_target_state(pack.id, "saves").await.unwrap();

    assert!(state.last_sync.is_none());
    assert!(state.content_sha1.is_none());
}

#[tokio::test]
async fn a_mod_i_switched_off_stays_off_after_a_restart() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let sodium = a_mod("sodium.jar");
    let lithium = a_mod("lithium.jar");
    store
        .manager
        .add_mods(pack.id, &[sodium.clone(), lithium.clone()])
        .await
        .unwrap();

    store.manager.set_mod_enabled(pack.id, sodium.id, false).await.unwrap();

    let reopened = store.restart().await;
    let again = reopened.require_pack(pack.id).await.unwrap();

    let off = again.mods.iter().find(|m| m.info.id == sodium.id).unwrap();
    let on = again.mods.iter().find(|m| m.info.id == lithium.id).unwrap();
    assert!(!off.info.enabled);
    assert!(on.info.enabled, "switching one mod off must not touch its neighbour");
}

#[tokio::test]
async fn a_version_i_pinned_survives_a_restart() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let sodium = a_mod("sodium.jar");
    store.manager.add_mods(pack.id, &[sodium.clone()]).await.unwrap();

    store
        .manager
        .set_mod_version_override(
            pack.id,
            sodium.id,
            "1.21.1",
            Some(VersionOverride::Pin {
                version_id: "abc".to_string(),
            }),
        )
        .await
        .unwrap();

    let reopened = store.restart().await;
    let again = reopened.require_pack(pack.id).await.unwrap();
    let entry = again.mods.iter().find(|m| m.info.id == sodium.id).unwrap();

    assert!(
        matches!(
            entry.version_overrides.get("1.21.1"),
            Some(VersionOverride::Pin { version_id }) if version_id == "abc"
        ),
        "a pinned version is a deliberate choice and must not be lost"
    );
}

#[tokio::test]
async fn removing_one_mod_leaves_the_rest_of_the_pack() {
    let store = Store::open().await;
    let pack = store.manager.create_pack("Worlds".to_string(), None, None).await.unwrap();
    let sodium = a_mod("sodium.jar");
    let lithium = a_mod("lithium.jar");
    store
        .manager
        .add_mods(pack.id, &[sodium.clone(), lithium.clone()])
        .await
        .unwrap();

    store.manager.remove_mod(pack.id, sodium.id).await.unwrap();

    let again = store.manager.require_pack(pack.id).await.unwrap();
    assert_eq!(again.mods.len(), 1);
    assert_eq!(again.mods[0].info.id, lithium.id);
}

#[tokio::test]
async fn without_a_database_the_launcher_says_so_instead_of_showing_no_packs() {
    let manager = SyncPackManager::new(db::new_handle()).unwrap();

    assert!(
        manager.list_packs().await.is_err(),
        "an empty list would make the player think their packs are gone"
    );
    assert!(!manager.is_available().await);
}
