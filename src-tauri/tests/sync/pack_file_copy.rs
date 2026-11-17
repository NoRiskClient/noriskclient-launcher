use crate::harness::*;
use noriskclient_launcher_v3_lib::sync::model::{DetachMode, SyncTargetKind};

const TARGET: &str = "servers.dat";

async fn setup() -> Shared {
    shared(SyncTargetKind::FileCopy, TARGET).await
}

#[tokio::test]
async fn a_server_i_added_in_one_profile_is_there_in_the_other() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    write(&alice.file(TARGET), "hypixel").await;
    s.launch(&alice).await;
    s.quit(&alice).await;

    s.launch(&bob).await;

    assert_eq!(
        read(&bob.file(TARGET)).await.as_deref(),
        Some("hypixel"),
        "the second profile did not receive the shared server list",
    );
}

#[tokio::test]
async fn a_profile_that_never_had_the_file_gets_it() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "from the pack").await;

    s.launch(&alice).await;

    assert_eq!(
        read(&alice.file(TARGET)).await.as_deref(),
        Some("from the pack")
    );
}

#[tokio::test]
async fn my_newer_list_is_not_replaced_by_an_older_one_from_the_pack() {
    let s = setup().await;
    let alice = s.player("alice");

    write(&s.master, "old shared list").await;
    write(&alice.file(TARGET), "my newer list").await;
    touch_older(&s.master).await;

    s.launch(&alice).await;

    assert_eq!(
        read(&alice.file(TARGET)).await.as_deref(),
        Some("my newer list"),
        "an older shared file overwrote the newer local one",
    );
}

#[tokio::test]
async fn a_newer_shared_list_reaches_me() {
    let s = setup().await;
    let alice = s.player("alice");

    write(&alice.file(TARGET), "my old list").await;
    write(&s.master, "newer shared list").await;
    touch_older(&alice.file(TARGET)).await;

    s.launch(&alice).await;

    assert_eq!(
        read(&alice.file(TARGET)).await.as_deref(),
        Some("newer shared list"),
    );
}

#[tokio::test]
async fn launching_twice_does_not_keep_rewriting_the_file() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "stable").await;

    s.launch(&alice).await;
    let first = s.launch(&alice).await;

    assert!(!first.changed, "an unchanged file was written again");
    assert_eq!(read(&alice.file(TARGET)).await.as_deref(), Some("stable"));
}

#[tokio::test]
async fn what_i_changed_while_playing_ends_up_in_the_pack() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "before").await;

    s.launch(&alice).await;
    write(&alice.file(TARGET), "i added a server").await;
    s.quit(&alice).await;

    assert_eq!(
        read(&s.master).await.as_deref(),
        Some("i added a server"),
        "the change never reached the pack",
    );
}

#[tokio::test]
async fn a_change_someone_else_made_later_is_not_quietly_overwritten() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "before").await;

    s.launch(&alice).await;
    write(&alice.file(TARGET), "alice edit").await;
    write(&s.master, "bob got there first").await;
    touch_newer(&s.master).await;

    let outcome = s.quit(&alice).await;

    assert_eq!(
        read(&s.master).await.as_deref(),
        Some("bob got there first")
    );
    assert!(
        !outcome.warnings.is_empty(),
        "the skipped write back has to be reported, not swallowed",
    );
}

#[tokio::test]
async fn quitting_without_changing_anything_leaves_the_pack_alone() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "untouched").await;

    s.launch(&alice).await;
    let outcome = s.quit(&alice).await;

    assert!(!outcome.changed);
    assert_eq!(read(&s.master).await.as_deref(), Some("untouched"));
}

#[tokio::test]
async fn turning_the_pack_off_leaves_my_file_in_place() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "shared list").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert_eq!(
        read(&alice.file(TARGET)).await.as_deref(),
        Some("shared list"),
        "unsubscribing removed the file from the profile",
    );
}

#[tokio::test]
async fn a_pack_file_that_disappeared_does_not_empty_my_profile() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "shared list").await;

    s.launch(&alice).await;
    tokio::fs::remove_file(&s.master).await.unwrap();

    s.launch(&alice).await;

    assert_eq!(
        read(&alice.file(TARGET)).await.as_deref(),
        Some("shared list"),
        "losing the pack file wiped the profile copy",
    );
}

#[tokio::test]
async fn the_newest_of_several_profiles_wins() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");
    let carol = s.player("carol");

    write(&s.master, "oldest").await;
    write(&alice.file(TARGET), "alice").await;
    write(&bob.file(TARGET), "bob is newest").await;
    touch_older(&s.master).await;
    touch_older(&alice.file(TARGET)).await;

    let others = [alice.as_subscriber(), bob.as_subscriber()];
    s.launch_with(&carol, &others).await;

    assert_eq!(
        read(&carol.file(TARGET)).await.as_deref(),
        Some("bob is newest"),
        "a stale copy won over the most recent one",
    );
}
