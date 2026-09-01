use crate::sync::handlers::scenario_support::*;
use crate::sync::model::{DetachMode, MergeFormat, SyncTargetKind};

// options.txt is the case where a whole-file copy would be wrong: two players share graphics
// settings but each keeps their own resource packs. These tests describe that from the player's
// side, not from the merge algorithm's.

const TARGET: &str = "options.txt";

fn merge_kind() -> SyncTargetKind {
    SyncTargetKind::FileMerge {
        format: MergeFormat::MinecraftOptions,
        local_keys: vec![
            "resourcePacks".to_string(),
            "incompatibleResourcePacks".to_string(),
        ],
    }
}

async fn setup() -> Shared {
    shared(merge_kind(), TARGET).await
}

fn line(doc: &str, key: &str) -> Option<String> {
    doc.lines()
        .find(|l| l.starts_with(&format!("{}:", key)))
        .map(|l| l.split_once(':').unwrap().1.to_string())
}

async fn value(path: &std::path::Path, key: &str) -> Option<String> {
    read(path).await.and_then(|doc| line(&doc, key))
}

#[tokio::test]
async fn a_setting_i_changed_reaches_the_other_profile() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    write(&alice.file(TARGET), "renderDistance:16\nmaxFps:120\n").await;
    s.launch(&alice).await;

    write(&bob.file(TARGET), "renderDistance:8\nmaxFps:60\n").await;
    touch_older(&bob.file(TARGET)).await;
    s.launch(&bob).await;

    assert_eq!(
        value(&bob.file(TARGET), "renderDistance").await.as_deref(),
        Some("16"),
        "the shared setting never arrived",
    );
}

#[tokio::test]
async fn my_resource_packs_stay_mine() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    write(
        &alice.file(TARGET),
        "renderDistance:16\nresourcePacks:[\"alice pack\"]\n",
    )
    .await;
    s.launch(&alice).await;

    write(
        &bob.file(TARGET),
        "renderDistance:8\nresourcePacks:[\"bob pack\"]\n",
    )
    .await;
    touch_older(&bob.file(TARGET)).await;
    s.launch(&bob).await;

    assert_eq!(
        value(&bob.file(TARGET), "resourcePacks").await.as_deref(),
        Some("[\"bob pack\"]"),
        "someone else's resource packs were forced onto this profile",
    );
    assert_eq!(
        value(&bob.file(TARGET), "renderDistance").await.as_deref(),
        Some("16"),
        "the shared setting should still have arrived",
    );
}

#[tokio::test]
async fn my_resource_packs_are_not_pushed_into_the_pack() {
    let s = setup().await;
    let alice = s.player("alice");

    write(
        &alice.file(TARGET),
        "renderDistance:16\nresourcePacks:[\"alice pack\"]\n",
    )
    .await;
    s.launch(&alice).await;

    assert_eq!(
        value(&s.master, "renderDistance").await.as_deref(),
        Some("16"),
    );
    assert_eq!(
        value(&s.master, "resourcePacks").await,
        None,
        "a local only key leaked into the shared file",
    );
}

#[tokio::test]
async fn a_setting_only_i_have_is_kept() {
    let s = setup().await;
    let alice = s.player("alice");

    write(&s.master, "renderDistance:16\n").await;
    write(&alice.file(TARGET), "renderDistance:8\nmyOwnSetting:yes\n").await;
    touch_older(&alice.file(TARGET)).await;

    s.launch(&alice).await;

    assert_eq!(
        value(&alice.file(TARGET), "myOwnSetting").await.as_deref(),
        Some("yes"),
        "a setting the pack does not know was dropped",
    );
    assert_eq!(
        value(&alice.file(TARGET), "renderDistance").await.as_deref(),
        Some("16"),
    );
}

#[tokio::test]
async fn a_profile_without_the_file_gets_the_shared_settings() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "renderDistance:16\nmaxFps:240\n").await;

    s.launch(&alice).await;

    assert_eq!(
        value(&alice.file(TARGET), "maxFps").await.as_deref(),
        Some("240"),
    );
}

#[tokio::test]
async fn my_newer_setting_is_not_replaced_by_an_older_shared_one() {
    let s = setup().await;
    let alice = s.player("alice");

    write(&s.master, "renderDistance:8\n").await;
    write(&alice.file(TARGET), "renderDistance:32\n").await;
    touch_older(&s.master).await;

    s.launch(&alice).await;

    assert_eq!(
        value(&alice.file(TARGET), "renderDistance").await.as_deref(),
        Some("32"),
        "an older shared value overwrote the newer local one",
    );
}

#[tokio::test]
async fn launching_twice_changes_nothing() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&alice.file(TARGET), "renderDistance:16\n").await;

    s.launch(&alice).await;
    let after_first = read(&alice.file(TARGET)).await;
    let outcome = s.launch(&alice).await;

    assert!(!outcome.changed, "an unchanged file was merged again");
    assert_eq!(read(&alice.file(TARGET)).await, after_first);
}

#[tokio::test]
async fn turning_the_pack_off_leaves_my_settings_in_place() {
    let s = setup().await;
    let alice = s.player("alice");
    write(&s.master, "renderDistance:16\n").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert_eq!(
        value(&alice.file(TARGET), "renderDistance").await.as_deref(),
        Some("16"),
        "unsubscribing emptied the settings file",
    );
}

#[tokio::test]
async fn what_two_profiles_changed_separately_both_survive() {
    let s = setup().await;
    let alice = s.player("alice");
    let bob = s.player("bob");

    write(&alice.file(TARGET), "renderDistance:16\n").await;
    s.launch(&alice).await;

    write(&bob.file(TARGET), "maxFps:240\n").await;
    s.launch(&bob).await;

    assert_eq!(
        value(&bob.file(TARGET), "maxFps").await.as_deref(),
        Some("240"),
        "the profile's own change was lost",
    );
    assert_eq!(
        value(&s.master, "renderDistance").await.as_deref(),
        Some("16"),
        "the other profile's change was lost from the pack",
    );
}
