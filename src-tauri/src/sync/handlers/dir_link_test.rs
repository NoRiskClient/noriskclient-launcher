use super::*;
use crate::state::db;
use crate::state::profile_state::{ModLoader, Profile, ProfileSettings, ProfileState};
use crate::state::sync_pack_state::SyncPackManager;
use crate::sync::model::{SyncPack, SyncTarget, SyncTargetKind};
use chrono::Utc;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

// This handler moves and deletes files a user has spent time on. Every test here drives the real
// DirLinkHandler against a real temporary filesystem, because the failure modes worth guarding
// (a save file overwritten by a pack, a local edit dropped without a backup) only exist on one.

struct Fixture {
    _dir: tempfile::TempDir,
    instance: PathBuf,
    master: PathBuf,
    manager: SyncPackManager,
    pack: SyncPack,
    profile: Profile,
    semaphore: Arc<Semaphore>,
}

async fn fixture(adopt: AdoptStrategy) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("instance");
    let master = dir.path().join("master");
    tokio::fs::create_dir_all(&instance).await.unwrap();

    let handle = db::new_handle();
    db::set_pool_for_test(&handle, db::test_pool().await).await;
    let manager = SyncPackManager::new(handle).unwrap();

    let pack = SyncPack {
        id: Uuid::new_v4(),
        name: "test".to_string(),
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

    Fixture {
        _dir: dir,
        instance,
        master,
        manager,
        pack,
        profile: profile(),
        semaphore: Arc::new(Semaphore::new(4)),
    }
}

fn profile() -> Profile {
    Profile {
        id: Uuid::new_v4(),
        name: "Test".to_string(),
        path: "test".to_string(),
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
    }
}

impl Fixture {
    fn context<'a>(
        &'a self,
        linked: &'a HashSet<String>,
        shared: bool,
    ) -> SyncContext<'a> {
        SyncContext {
            pack: &self.pack,
            target: &self.pack.targets[0],
            profile: &self.profile,
            instance_dir: &self.instance,
            subscriber_instances: &[],
            linked_dirs: linked,
            instance_shared_with_other_subscriber: shared,
            manager: &self.manager,
            io_semaphore: Arc::clone(&self.semaphore),
        }
    }

    fn linked(&self) -> PathBuf {
        self.instance.join("saves")
    }

    async fn apply(&self) -> HandlerOutcome {
        let linked = HashSet::new();
        DirLinkHandler
            .apply_pre_launch(&self.context(&linked, false))
            .await
            .unwrap()
    }

    async fn detach(&self, mode: DetachMode, shared: bool) -> HandlerOutcome {
        let linked = HashSet::new();
        DirLinkHandler
            .detach(&self.context(&linked, shared), mode)
            .await
            .unwrap()
    }
}

async fn write(path: &Path, body: &str) {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.unwrap();
    }
    tokio::fs::write(path, body).await.unwrap();
}

async fn read(path: &Path) -> String {
    tokio::fs::read_to_string(path).await.unwrap()
}

async fn entries(dir: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut read_dir = tokio::fs::read_dir(dir).await.unwrap();
    while let Some(entry) = read_dir.next_entry().await.unwrap() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() {
            out.insert(name, read(&entry.path()).await);
        } else {
            out.insert(name, String::from("<dir>"));
        }
    }
    out
}

async fn set_older(path: &Path) {
    let meta = tokio::fs::metadata(path).await.unwrap();
    let modified = meta.modified().unwrap() - std::time::Duration::from_secs(60);
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(modified).unwrap();
    })
    .await
    .unwrap();
}

async fn backup_dirs(instance: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut read_dir = tokio::fs::read_dir(instance).await.unwrap();
    while let Some(entry) = read_dir.next_entry().await.unwrap() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("saves.local-") {
            out.push(entry.path());
        }
    }
    out
}

#[tokio::test]
async fn an_empty_master_takes_every_local_file() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.instance.join("saves/world/level.dat"), "mine").await;
    write(&f.instance.join("saves/readme.txt"), "notes").await;

    f.apply().await;

    assert_eq!(read(&f.master.join("world/level.dat")).await, "mine");
    assert_eq!(read(&f.master.join("readme.txt")).await, "notes");
    assert!(symlink_utils::is_symlink(&f.linked()).await.unwrap());
}

#[tokio::test]
async fn the_link_resolves_to_the_master() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("shared.txt"), "from pack").await;

    f.apply().await;

    assert_eq!(read(&f.linked().join("shared.txt")).await, "from pack");
}

#[tokio::test]
async fn a_collision_keeps_the_master_and_parks_the_local_copy() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("level.dat"), "pack").await;
    write(&f.instance.join("saves/level.dat"), "mine").await;

    f.apply().await;

    assert_eq!(read(&f.master.join("level.dat")).await, "pack");
    let backups = backup_dirs(&f.instance).await;
    assert_eq!(backups.len(), 1, "the local file was dropped, not parked");
    assert_eq!(read(&backups[0].join("level.dat")).await, "mine");
}

#[tokio::test]
async fn prefer_instance_keeps_the_local_copy_and_parks_the_master() {
    let f = fixture(AdoptStrategy::PreferInstance).await;
    write(&f.master.join("level.dat"), "pack").await;
    write(&f.instance.join("saves/level.dat"), "mine").await;

    f.apply().await;

    assert_eq!(read(&f.master.join("level.dat")).await, "mine");
    let backups = backup_dirs(&f.instance).await;
    assert_eq!(backups.len(), 1);
    assert_eq!(read(&backups[0].join("level.dat")).await, "pack");
}

#[tokio::test]
async fn prefer_newer_keeps_whichever_was_written_last() {
    let f = fixture(AdoptStrategy::PreferNewer).await;
    write(&f.master.join("level.dat"), "older").await;
    write(&f.instance.join("saves/level.dat"), "newer").await;
    set_older(&f.master.join("level.dat")).await;

    f.apply().await;

    assert_eq!(read(&f.master.join("level.dat")).await, "newer");
}

#[tokio::test]
async fn nothing_is_ever_deleted_without_a_backup_on_a_first_adopt() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("a.txt"), "pack a").await;
    write(&f.instance.join("saves/a.txt"), "mine a").await;
    write(&f.instance.join("saves/b.txt"), "mine b").await;

    f.apply().await;

    let backups = backup_dirs(&f.instance).await;
    let parked = entries(&backups[0]).await;
    assert_eq!(parked.get("a.txt").map(String::as_str), Some("mine a"));
    assert_eq!(read(&f.master.join("b.txt")).await, "mine b");
}

#[tokio::test]
async fn re_enabling_after_keep_copy_parks_the_copy_rather_than_deleting_it() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("level.dat"), "pack").await;
    write(&f.instance.join("saves/level.dat"), "mine").await;

    f.apply().await;
    f.detach(DetachMode::KeepCopy, false).await;

    assert!(
        !f.manager
            .is_adopted(f.pack.id, "saves", f.profile.id)
            .await
            .unwrap(),
        "a copy the user can edit must not stay marked as ours",
    );

    write(&f.linked().join("level.dat"), "edited while off").await;
    f.apply().await;

    let backups = backup_dirs(&f.instance).await;
    let parked = backups.len();
    let mut found = false;
    for backup in &backups {
        if let Ok(body) = tokio::fs::read_to_string(backup.join("level.dat")).await {
            if body == "edited while off" {
                found = true;
            }
        }
    }
    assert!(found, "the edit was dropped, {} backup folder(s) present", parked);
    assert_eq!(read(&f.master.join("level.dat")).await, "pack");
}

#[tokio::test]
async fn an_existing_correct_link_is_left_alone() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("keep.txt"), "pack").await;

    f.apply().await;
    let outcome = f.apply().await;

    assert!(!outcome.changed, "the link was rebuilt for nothing");
    assert_eq!(read(&f.linked().join("keep.txt")).await, "pack");
}

#[tokio::test]
async fn a_file_where_the_folder_should_be_is_reported_not_replaced() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.instance.join("saves"), "this is a file").await;

    let outcome = f.apply().await;

    assert!(!outcome.warnings.is_empty(), "replacing a file must be refused loudly");
    assert_eq!(read(&f.linked()).await, "this is a file");
}

#[tokio::test]
async fn keep_copy_restores_the_content_into_the_profile() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("world/level.dat"), "pack").await;

    f.apply().await;
    f.detach(DetachMode::KeepCopy, false).await;

    assert!(!symlink_utils::is_symlink(&f.linked()).await.unwrap());
    assert_eq!(read(&f.linked().join("world/level.dat")).await, "pack");
    assert_eq!(read(&f.master.join("world/level.dat")).await, "pack");
}

#[tokio::test]
async fn drop_leaves_an_empty_folder_and_forgets_the_adoption() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("world/level.dat"), "pack").await;

    f.apply().await;
    f.detach(DetachMode::Drop, false).await;

    assert!(!symlink_utils::is_symlink(&f.linked()).await.unwrap());
    assert!(entries(&f.linked()).await.is_empty());
    assert_eq!(read(&f.master.join("world/level.dat")).await, "pack");
    assert!(
        !f.manager
            .is_adopted(f.pack.id, "saves", f.profile.id)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn leave_link_does_not_touch_the_link() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("keep.txt"), "pack").await;

    f.apply().await;
    let outcome = f.detach(DetachMode::LeaveLink, false).await;

    assert!(!outcome.changed);
    assert!(symlink_utils::is_symlink(&f.linked()).await.unwrap());
}

#[tokio::test]
async fn a_folder_another_subscriber_still_uses_stays_linked() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.master.join("keep.txt"), "pack").await;

    f.apply().await;
    let outcome = f.detach(DetachMode::KeepCopy, true).await;

    assert!(symlink_utils::is_symlink(&f.linked()).await.unwrap());
    assert!(!outcome.warnings.is_empty());
}

#[tokio::test]
async fn a_link_pointing_somewhere_else_is_repointed() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    let stray = f._dir.path().join("stray");
    tokio::fs::create_dir_all(&stray).await.unwrap();
    write(&stray.join("stray.txt"), "elsewhere").await;
    write(&f.master.join("correct.txt"), "pack").await;
    symlink_utils::create_symlink(&stray, &f.linked(), true)
        .await
        .unwrap();

    f.apply().await;

    assert_eq!(read(&f.linked().join("correct.txt")).await, "pack");
    assert_eq!(
        read(&stray.join("stray.txt")).await,
        "elsewhere",
        "the folder the stale link pointed at must not be touched",
    );
}

#[tokio::test]
async fn a_nested_folder_is_moved_whole() {
    let f = fixture(AdoptStrategy::BackupLocal).await;
    write(&f.instance.join("saves/world/region/r.0.0.mca"), "chunks").await;

    f.apply().await;

    assert_eq!(read(&f.master.join("world/region/r.0.0.mca")).await, "chunks");
}
