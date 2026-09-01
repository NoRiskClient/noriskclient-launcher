use super::*;
use crate::state::db;
use crate::state::profile_state::{ModLoader, Profile, ProfileSettings, ProfileState};
use crate::state::sync_pack_state::SyncPackManager;
use crate::sync::model::{SyncPack, SyncTarget, SyncTargetKind};
use chrono::Utc;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

// These tests are written from what a player expects, not from what the handler currently does.
// A failure here is a finding about the feature, not about the test.

struct World {
    _dir: tempfile::TempDir,
    master: PathBuf,
    manager: SyncPackManager,
    pack: SyncPack,
    semaphore: Arc<Semaphore>,
}

struct Player {
    instance: PathBuf,
    profile: Profile,
}

async fn world(adopt: AdoptStrategy) -> World {
    let dir = tempfile::tempdir().unwrap();
    let master = dir.path().join("pack-master");

    let handle = db::new_handle();
    db::set_pool_for_test(&handle, db::test_pool().await).await;

    let pack = SyncPack {
        id: Uuid::new_v4(),
        name: "shared worlds".to_string(),
        description: None,
        icon: None,
        enabled: true,
        sort_order: 0,
        created: Utc::now(),
        updated: Utc::now(),
        targets: vec![SyncTarget {
            id: Uuid::new_v4(),
            path: "saves".to_string(),
            enabled: true,
            kind: SyncTargetKind::DirLink { adopt },
            external_path: Some(master.to_string_lossy().to_string()),
        }],
        mods: Vec::new(),
    };

    World {
        _dir: dir,
        master,
        manager: SyncPackManager::new(handle).unwrap(),
        pack,
        semaphore: Arc::new(Semaphore::new(4)),
    }
}

impl World {
    fn player(&self, name: &str) -> Player {
        let instance = self._dir.path().join(name);
        std::fs::create_dir_all(&instance).unwrap();
        Player {
            instance,
            profile: Profile {
                id: Uuid::new_v4(),
                name: name.to_string(),
                path: name.to_string(),
                game_version: "1.21.1".to_string(),
                loader: ModLoader::Fabric,
                loader_version: None,
                created: Utc::now(),
                last_played: None,
                settings: ProfileSettings::default(),
                state: ProfileState::NotInstalled,
                mods: Vec::new(),
                selected_norisk_pack_id: None,
                disabled_norisk_mods_detailed: HashSet::new(),
                source_standard_profile_id: None,
                group: None,
                use_shared_minecraft_folder: false,
                is_standard_version: false,
                description: None,
                banner: None,
                background: None,
                norisk_information: None,
                modpack_info: None,
                preferred_account_id: None,
                playtime_seconds: 0,
                sync_pack_ids: Vec::new(),
                extra: serde_json::Map::new(),
            },
        }
    }

    async fn launch(&self, player: &Player) {
        let linked = HashSet::new();
        let ctx = SyncContext {
            pack: &self.pack,
            target: &self.pack.targets[0],
            profile: &player.profile,
            instance_dir: &player.instance,
            subscriber_instances: &[],
            linked_dirs: &linked,
            instance_shared_with_other_subscriber: false,
            manager: &self.manager,
            io_semaphore: Arc::clone(&self.semaphore),
        };
        DirLinkHandler.apply_pre_launch(&ctx).await.unwrap();
    }

    async fn unsubscribe(&self, player: &Player, mode: DetachMode) {
        let linked = HashSet::new();
        let ctx = SyncContext {
            pack: &self.pack,
            target: &self.pack.targets[0],
            profile: &player.profile,
            instance_dir: &player.instance,
            subscriber_instances: &[],
            linked_dirs: &linked,
            instance_shared_with_other_subscriber: false,
            manager: &self.manager,
            io_semaphore: Arc::clone(&self.semaphore),
        };
        DirLinkHandler.detach(&ctx, mode).await.unwrap();
    }
}

impl Player {
    fn saves(&self) -> PathBuf {
        self.instance.join("saves")
    }
}

async fn play(player: &Player, world_name: &str, body: &str) {
    let path = player.saves().join(world_name).join("level.dat");
    tokio::fs::create_dir_all(path.parent().unwrap()).await.unwrap();
    tokio::fs::write(&path, body).await.unwrap();
}

async fn world_content(player: &Player, world_name: &str) -> Option<String> {
    tokio::fs::read_to_string(player.saves().join(world_name).join("level.dat"))
        .await
        .ok()
}

async fn anything_containing(dir: &Path, needle: &str) -> bool {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(mut entries) = tokio::fs::read_dir(&current).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(body) = tokio::fs::read_to_string(&path).await {
                if body == needle {
                    return true;
                }
            }
        }
    }
    false
}

#[tokio::test]
async fn a_world_saved_in_one_profile_shows_up_in_the_other() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");
    let bob = w.player("bob");

    w.launch(&alice).await;
    play(&alice, "survival", "alice was here").await;

    w.launch(&bob).await;

    assert_eq!(
        world_content(&bob, "survival").await.as_deref(),
        Some("alice was here"),
        "the second profile did not see the shared world",
    );
}

#[tokio::test]
async fn a_world_saved_in_the_second_profile_reaches_the_first() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");
    let bob = w.player("bob");

    w.launch(&alice).await;
    w.launch(&bob).await;
    play(&bob, "creative", "bob built this").await;

    assert_eq!(
        world_content(&alice, "creative").await.as_deref(),
        Some("bob built this"),
        "sharing only worked in one direction",
    );
}

#[tokio::test]
async fn turning_the_pack_off_leaves_my_worlds_in_the_profile() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    w.launch(&alice).await;
    play(&alice, "survival", "hours of work").await;
    w.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert_eq!(
        world_content(&alice, "survival").await.as_deref(),
        Some("hours of work"),
        "unsubscribing took the worlds away",
    );
}

#[tokio::test]
async fn a_world_i_changed_while_unsubscribed_is_not_silently_lost() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    w.launch(&alice).await;
    play(&alice, "survival", "before").await;
    w.unsubscribe(&alice, DetachMode::KeepCopy).await;

    play(&alice, "survival", "played offline, must not vanish").await;
    w.launch(&alice).await;

    let visible = world_content(&alice, "survival").await;
    let parked = anything_containing(&alice.instance, "played offline, must not vanish").await;

    assert!(
        visible.as_deref() == Some("played offline, must not vanish") || parked,
        "the offline change is gone: neither in the world nor in a backup, world reads {:?}",
        visible,
    );
}

#[tokio::test]
async fn worlds_that_existed_before_the_pack_are_never_just_deleted() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    tokio::fs::create_dir_all(w.master.join("survival")).await.unwrap();
    tokio::fs::write(w.master.join("survival/level.dat"), "from the pack")
        .await
        .unwrap();
    play(&alice, "survival", "my own world").await;

    w.launch(&alice).await;

    assert!(
        anything_containing(&alice.instance, "my own world").await
            || anything_containing(&w.master, "my own world").await,
        "the world that was there before the pack was deleted without a copy",
    );
}

#[tokio::test]
async fn launching_twice_changes_nothing() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    play(&alice, "survival", "mine").await;
    w.launch(&alice).await;
    let after_first = world_content(&alice, "survival").await;

    w.launch(&alice).await;
    w.launch(&alice).await;

    assert_eq!(world_content(&alice, "survival").await, after_first);
    let mut backups = 0;
    let mut entries = tokio::fs::read_dir(&alice.instance).await.unwrap();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name().to_string_lossy().contains(".local-") {
            backups += 1;
        }
    }
    assert_eq!(backups, 0, "repeated launches piled up backup folders");
}

#[tokio::test]
async fn unsubscribing_one_profile_leaves_the_other_working() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");
    let bob = w.player("bob");

    w.launch(&alice).await;
    w.launch(&bob).await;
    play(&alice, "survival", "shared").await;

    w.unsubscribe(&bob, DetachMode::KeepCopy).await;

    assert_eq!(
        world_content(&alice, "survival").await.as_deref(),
        Some("shared"),
        "one profile leaving broke the other",
    );
}

#[tokio::test]
async fn a_pack_folder_that_disappeared_does_not_take_the_profile_with_it() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    w.launch(&alice).await;
    play(&alice, "survival", "still mine").await;
    w.unsubscribe(&alice, DetachMode::KeepCopy).await;
    tokio::fs::remove_dir_all(&w.master).await.unwrap();

    w.launch(&alice).await;

    assert!(
        anything_containing(&alice.instance, "still mine").await,
        "losing the pack folder emptied the profile",
    );
}

#[tokio::test]
async fn an_offline_change_survives_even_after_the_pack_once_adopted_my_folder() {
    let w = world(AdoptStrategy::BackupLocal).await;
    let alice = w.player("alice");

    tokio::fs::create_dir_all(w.master.join("survival")).await.unwrap();
    tokio::fs::write(w.master.join("survival/level.dat"), "from the pack")
        .await
        .unwrap();
    play(&alice, "survival", "my original world").await;

    w.launch(&alice).await;
    w.unsubscribe(&alice, DetachMode::KeepCopy).await;

    play(&alice, "survival", "played offline, must not vanish").await;
    w.launch(&alice).await;

    let visible = world_content(&alice, "survival").await;
    let parked = anything_containing(&alice.instance, "played offline, must not vanish").await;

    assert!(
        visible.as_deref() == Some("played offline, must not vanish") || parked,
        "the offline change is gone: neither in the world nor in a backup, world reads {:?}",
        visible,
    );
}
