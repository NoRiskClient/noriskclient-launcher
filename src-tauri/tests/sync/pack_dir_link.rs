use crate::harness::*;
use noriskclient_launcher_v3_lib::sync::model::{AdoptStrategy, DetachMode, SyncTargetKind};
use noriskclient_launcher_v3_lib::utils::symlink_utils;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const TARGET: &str = "saves";

async fn setup(adopt: AdoptStrategy) -> Shared {
    shared(SyncTargetKind::DirLink { adopt }, TARGET).await
}

async fn entries(dir: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut items = tokio::fs::read_dir(dir).await.unwrap();
    while let Some(entry) = items.next_entry().await.unwrap() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() {
            out.insert(name, text(&entry.path()).await);
        } else {
            out.insert(name, String::from("<dir>"));
        }
    }
    out
}

async fn backup_dirs(instance: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut items = tokio::fs::read_dir(instance).await.unwrap();
    while let Some(entry) = items.next_entry().await.unwrap() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("saves.local-")
        {
            out.push(entry.path());
        }
    }
    out
}

#[tokio::test]
async fn an_empty_master_takes_every_local_file() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&alice.file(TARGET).join("world/level.dat"), "mine").await;
    write(&alice.file(TARGET).join("readme.txt"), "notes").await;

    s.launch(&alice).await;

    assert_eq!(text(&s.master.join("world/level.dat")).await, "mine");
    assert_eq!(text(&s.master.join("readme.txt")).await, "notes");
    assert!(symlink_utils::is_symlink(&alice.file(TARGET))
        .await
        .unwrap());
}

#[tokio::test]
async fn the_link_resolves_to_the_master() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("shared.txt"), "from pack").await;

    s.launch(&alice).await;

    assert_eq!(
        text(&alice.file(TARGET).join("shared.txt")).await,
        "from pack"
    );
}

#[tokio::test]
async fn a_collision_keeps_the_master_and_parks_the_local_copy() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("level.dat"), "pack").await;
    write(&alice.file(TARGET).join("level.dat"), "mine").await;

    s.launch(&alice).await;

    assert_eq!(text(&s.master.join("level.dat")).await, "pack");
    let backups = backup_dirs(&alice.instance).await;
    assert_eq!(backups.len(), 1, "the local file was dropped, not parked");
    assert_eq!(text(&backups[0].join("level.dat")).await, "mine");
}

#[tokio::test]
async fn prefer_instance_keeps_the_local_copy_and_parks_the_master() {
    let s = setup(AdoptStrategy::PreferInstance).await;
    let alice = s.player("alice");
    write(&s.master.join("level.dat"), "pack").await;
    write(&alice.file(TARGET).join("level.dat"), "mine").await;

    s.launch(&alice).await;

    assert_eq!(text(&s.master.join("level.dat")).await, "mine");
    let backups = backup_dirs(&alice.instance).await;
    assert_eq!(backups.len(), 1);
    assert_eq!(text(&backups[0].join("level.dat")).await, "pack");
}

#[tokio::test]
async fn prefer_newer_keeps_whichever_was_written_last() {
    let s = setup(AdoptStrategy::PreferNewer).await;
    let alice = s.player("alice");
    write(&s.master.join("level.dat"), "older").await;
    write(&alice.file(TARGET).join("level.dat"), "newer").await;
    touch_older(&s.master.join("level.dat")).await;

    s.launch(&alice).await;

    assert_eq!(text(&s.master.join("level.dat")).await, "newer");
}

#[tokio::test]
async fn nothing_is_ever_deleted_without_a_backup_on_a_first_adopt() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("a.txt"), "pack a").await;
    write(&alice.file(TARGET).join("a.txt"), "mine a").await;
    write(&alice.file(TARGET).join("b.txt"), "mine b").await;

    s.launch(&alice).await;

    let backups = backup_dirs(&alice.instance).await;
    let parked = entries(&backups[0]).await;
    assert_eq!(parked.get("a.txt").map(String::as_str), Some("mine a"));
    assert_eq!(text(&s.master.join("b.txt")).await, "mine b");
}

#[tokio::test]
async fn re_enabling_after_keep_copy_parks_the_copy_rather_than_deleting_it() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("level.dat"), "pack").await;
    write(&alice.file(TARGET).join("level.dat"), "mine").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert!(
        !s.manager
            .is_adopted(s.pack.id, TARGET, alice.profile.id)
            .await
            .unwrap(),
        "a copy the user can edit must not stay marked as ours",
    );

    write(&alice.file(TARGET).join("level.dat"), "edited while off").await;
    s.launch(&alice).await;

    let backups = backup_dirs(&alice.instance).await;
    let mut found = false;
    for backup in &backups {
        if let Ok(body) = tokio::fs::read_to_string(backup.join("level.dat")).await {
            if body == "edited while off" {
                found = true;
            }
        }
    }
    assert!(
        found,
        "the edit was dropped, {} backup folder(s) present",
        backups.len()
    );
    assert_eq!(text(&s.master.join("level.dat")).await, "pack");
}

#[tokio::test]
async fn an_existing_correct_link_is_left_alone() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("keep.txt"), "pack").await;

    s.launch(&alice).await;
    let outcome = s.launch(&alice).await;

    assert!(!outcome.changed, "the link was rebuilt for nothing");
    assert_eq!(text(&alice.file(TARGET).join("keep.txt")).await, "pack");
}

#[tokio::test]
async fn a_file_where_the_folder_should_be_is_reported_not_replaced() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&alice.file(TARGET), "this is a file").await;

    let outcome = s.launch(&alice).await;

    assert!(
        !outcome.warnings.is_empty(),
        "replacing a file must be refused loudly"
    );
    assert_eq!(text(&alice.file(TARGET)).await, "this is a file");
}

#[tokio::test]
async fn keep_copy_restores_the_content_into_the_profile() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("world/level.dat"), "pack").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::KeepCopy).await;

    assert!(!symlink_utils::is_symlink(&alice.file(TARGET))
        .await
        .unwrap());
    assert_eq!(
        text(&alice.file(TARGET).join("world/level.dat")).await,
        "pack"
    );
    assert_eq!(text(&s.master.join("world/level.dat")).await, "pack");
}

#[tokio::test]
async fn drop_leaves_an_empty_folder_and_forgets_the_adoption() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("world/level.dat"), "pack").await;

    s.launch(&alice).await;
    s.unsubscribe(&alice, DetachMode::Drop).await;

    assert!(!symlink_utils::is_symlink(&alice.file(TARGET))
        .await
        .unwrap());
    assert!(entries(&alice.file(TARGET)).await.is_empty());
    assert_eq!(text(&s.master.join("world/level.dat")).await, "pack");
    assert!(!s
        .manager
        .is_adopted(s.pack.id, TARGET, alice.profile.id)
        .await
        .unwrap());
}

#[tokio::test]
async fn leave_link_does_not_touch_the_link() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("keep.txt"), "pack").await;

    s.launch(&alice).await;
    let outcome = s.unsubscribe(&alice, DetachMode::LeaveLink).await;

    assert!(!outcome.changed);
    assert!(symlink_utils::is_symlink(&alice.file(TARGET))
        .await
        .unwrap());
}

#[tokio::test]
async fn a_folder_another_subscriber_still_uses_stays_linked() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&s.master.join("keep.txt"), "pack").await;

    s.launch(&alice).await;
    let outcome = s
        .unsubscribe_shared(&alice, DetachMode::KeepCopy, true)
        .await;

    assert!(symlink_utils::is_symlink(&alice.file(TARGET))
        .await
        .unwrap());
    assert!(!outcome.warnings.is_empty());
}

#[tokio::test]
async fn a_link_pointing_somewhere_else_is_repointed() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    let stray = s.dir.path().join("stray");
    tokio::fs::create_dir_all(&stray).await.unwrap();
    write(&stray.join("stray.txt"), "elsewhere").await;
    write(&s.master.join("correct.txt"), "pack").await;
    symlink_utils::create_symlink(&stray, &alice.file(TARGET), true)
        .await
        .unwrap();

    s.launch(&alice).await;

    assert_eq!(text(&alice.file(TARGET).join("correct.txt")).await, "pack");
    assert_eq!(
        text(&stray.join("stray.txt")).await,
        "elsewhere",
        "the folder the stale link pointed at must not be touched",
    );
}

#[tokio::test]
async fn a_nested_folder_is_moved_whole() {
    let s = setup(AdoptStrategy::BackupLocal).await;
    let alice = s.player("alice");
    write(&alice.file(TARGET).join("world/region/r.0.0.mca"), "chunks").await;

    s.launch(&alice).await;

    assert_eq!(
        text(&s.master.join("world/region/r.0.0.mca")).await,
        "chunks"
    );
}
