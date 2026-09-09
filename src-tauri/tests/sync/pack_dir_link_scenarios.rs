use crate::harness::*;
use noriskclient_launcher_v3_lib::sync::model::{AdoptStrategy, DetachMode, SyncTargetKind};
use std::path::Path;

const TARGET: &str = "saves";

async fn setup() -> Shared {
    shared(
        SyncTargetKind::DirLink {
            adopt: AdoptStrategy::BackupLocal,
        },
        TARGET,
    )
    .await
}

async fn play(player: &Player, world: &str, body: &str) {
    write(&player.file(TARGET).join(world).join("level.dat"), body).await;
}

async fn world_content(player: &Player, world: &str) -> Option<String> {
    read(&player.file(TARGET).join(world).join("level.dat")).await
}

async fn pack_holds(master: &Path, world: &str, body: &str) {
    write(&master.join(world).join("level.dat"), body).await;
}

async fn anything_containing(dir: &Path, needle: &str) -> bool {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(mut items) = tokio::fs::read_dir(&current).await else {
            continue;
        };
        while let Ok(Some(entry)) = items.next_entry().await {
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

async fn backup_count(instance: &Path) -> usize {
    let mut count = 0;
    let mut items = tokio::fs::read_dir(instance).await.unwrap();
    while let Ok(Some(entry)) = items.next_entry().await {
        if entry.file_name().to_string_lossy().contains(".local-") {
            count += 1;
        }
    }
    count
}

#[tokio::test]
async fn a_world_saved_in_one_profile_shows_up_in_the_other() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    s.launch(&alice).await;
    play(&alice, "survival", "alice was here").await;

    s.launch(&bob).await;

    assert_eq!(
        world_content(&bob, "survival").await.as_deref(),
        Some("alice was here"),
        "the second profile did not see the shared world",
    );
}

#[tokio::test]
async fn a_world_saved_in_the_second_profile_reaches_the_first() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    s.launch(&alice).await;
    s.launch(&bob).await;
    play(&bob, "creative", "bob built this").await;

    assert_eq!(
        world_content(&alice, "creative").await.as_deref(),
        Some("bob built this"),
        "sharing only worked in one direction",
    );
}

#[tokio::test]
async fn turning_the_pack_off_leaves_my_worlds_in_the_profile() {
    let s = setup().await;
    let alice = s.player("alice");

    s.launch(&alice).await;
    play(&alice, "survival", "hours of work").await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert_eq!(
        world_content(&alice, "survival").await.as_deref(),
        Some("hours of work"),
        "unsubscribing took the worlds away",
    );
}

#[tokio::test]
async fn a_world_i_changed_while_unsubscribed_is_not_silently_lost() {
    let s = setup().await;
    let alice = s.player("alice");

    s.launch(&alice).await;
    play(&alice, "survival", "before").await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    play(&alice, "survival", "played offline, must not vanish").await;
    s.launch(&alice).await;

    let visible = world_content(&alice, "survival").await;
    let parked = anything_containing(&alice.instance, "played offline, must not vanish").await;

    assert!(
        visible.as_deref() == Some("played offline, must not vanish") || parked,
        "the offline change is gone: neither in the world nor in a backup, world reads {:?}",
        visible,
    );
}

#[tokio::test]
async fn an_offline_change_survives_even_after_the_pack_once_adopted_my_folder() {
    let s = setup().await;
    let alice = s.player("alice");

    pack_holds(&s.master, "survival", "from the pack").await;
    play(&alice, "survival", "my original world").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    play(&alice, "survival", "played offline, must not vanish").await;
    s.launch(&alice).await;

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
    let s = setup().await;
    let alice = s.player("alice");

    pack_holds(&s.master, "survival", "from the pack").await;
    play(&alice, "survival", "my own world").await;

    s.launch(&alice).await;

    assert!(
        anything_containing(&alice.instance, "my own world").await
            || anything_containing(&s.master, "my own world").await,
        "the world that was there before the pack was deleted without a copy",
    );
}

#[tokio::test]
async fn launching_twice_changes_nothing() {
    let s = setup().await;
    let alice = s.player("alice");

    play(&alice, "survival", "mine").await;
    s.launch(&alice).await;
    let after_first = world_content(&alice, "survival").await;

    s.launch(&alice).await;
    s.launch(&alice).await;

    assert_eq!(world_content(&alice, "survival").await, after_first);
    assert_eq!(
        backup_count(&alice.instance).await,
        0,
        "repeated launches piled up backup folders",
    );
}

#[tokio::test]
async fn unsubscribing_one_profile_leaves_the_other_working() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    s.launch(&alice).await;
    s.launch(&bob).await;
    play(&alice, "survival", "shared").await;

    s.unsubscribe(&bob, DetachMode::KeepCopy).await;

    assert_eq!(
        world_content(&alice, "survival").await.as_deref(),
        Some("shared"),
        "one profile leaving broke the other",
    );
}

#[tokio::test]
async fn a_pack_folder_that_disappeared_does_not_take_the_profile_with_it() {
    let s = setup().await;
    let alice = s.player("alice");

    s.launch(&alice).await;
    play(&alice, "survival", "still mine").await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;
    tokio::fs::remove_dir_all(&s.master).await.unwrap();

    s.launch(&alice).await;

    assert!(
        anything_containing(&alice.instance, "still mine").await,
        "losing the pack folder emptied the profile",
    );
}
