use crate::state::db;
use crate::state::profile_state::{ModLoader, Profile, ProfileSettings, ProfileState};
use crate::state::sync_pack_state::SyncPackManager;
use crate::sync::context::SyncContext;
use crate::sync::handlers::dir_link::DirLinkHandler;
use crate::sync::handlers::file_copy::FileCopyHandler;
use crate::sync::handlers::options_merge::OptionsMergeHandler;
use crate::sync::handlers::SyncHandler;
use crate::sync::model::{DetachMode, SyncPack, SyncTarget, SyncTargetKind};
use crate::sync::report::HandlerOutcome;
use chrono::Utc;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

// Drives the real handlers the way the engine does, against a temporary filesystem, so scenarios
// can be written the way a player would describe them: two profiles, a shared folder or file,
// launch, play, quit, unsubscribe.

pub struct Shared {
    pub dir: tempfile::TempDir,
    pub master: PathBuf,
    pub manager: SyncPackManager,
    pub pack: SyncPack,
    semaphore: Arc<Semaphore>,
}

pub struct Player {
    pub instance: PathBuf,
    pub profile: Profile,
}

pub async fn shared(kind: SyncTargetKind, target_path: &str) -> Shared {
    let dir = tempfile::tempdir().unwrap();
    let master = dir.path().join("pack-master").join(target_path);

    let handle = db::new_handle();
    db::set_pool_for_test(&handle, db::test_pool().await).await;

    let pack = SyncPack {
        id: Uuid::new_v4(),
        name: "shared".to_string(),
        description: None,
        icon: None,
        enabled: true,
        sort_order: 0,
        created: Utc::now(),
        updated: Utc::now(),
        targets: vec![SyncTarget {
            id: Uuid::new_v4(),
            path: target_path.to_string(),
            enabled: true,
            kind,
            external_path: Some(master.to_string_lossy().to_string()),
        }],
        mods: Vec::new(),
    };

    Shared {
        dir,
        master,
        manager: SyncPackManager::new(handle).unwrap(),
        pack,
        semaphore: Arc::new(Semaphore::new(4)),
    }
}

impl Shared {
    pub fn player(&self, name: &str) -> Player {
        let instance = self.dir.path().join(name);
        std::fs::create_dir_all(&instance).unwrap();
        Player {
            instance,
            profile: test_profile(name),
        }
    }

    fn context<'a>(
        &'a self,
        player: &'a Player,
        others: &'a [(Uuid, PathBuf)],
        links: &'a HashSet<String>,
    ) -> SyncContext<'a> {
        SyncContext {
            pack: &self.pack,
            target: &self.pack.targets[0],
            profile: &player.profile,
            instance_dir: &player.instance,
            subscriber_instances: others,
            linked_dirs: links,
            instance_shared_with_other_subscriber: false,
            manager: &self.manager,
            io_semaphore: Arc::clone(&self.semaphore),
        }
    }

    fn handler(&self) -> &'static dyn SyncHandler {
        match &self.pack.targets[0].kind {
            SyncTargetKind::DirLink { .. } => &DirLinkHandler,
            SyncTargetKind::FileMerge { .. } => &OptionsMergeHandler,
            _ => &FileCopyHandler,
        }
    }

    pub async fn launch(&self, player: &Player) -> HandlerOutcome {
        self.launch_with(player, &[]).await
    }

    pub async fn launch_with(
        &self,
        player: &Player,
        others: &[(Uuid, PathBuf)],
    ) -> HandlerOutcome {
        self.handler()
            .apply_pre_launch(&self.context(player, others, &HashSet::new()))
            .await
            .unwrap()
    }

    pub async fn quit(&self, player: &Player) -> HandlerOutcome {
        self.handler()
            .write_back_post_exit(&self.context(player, &[], &HashSet::new()))
            .await
            .unwrap()
    }

    pub async fn unsubscribe(&self, player: &Player, mode: DetachMode) -> HandlerOutcome {
        self.handler()
            .detach(&self.context(player, &[], &HashSet::new()), mode)
            .await
            .unwrap()
    }
}

impl Player {
    pub fn file(&self, target_path: &str) -> PathBuf {
        self.instance.join(target_path)
    }

    pub fn as_subscriber(&self) -> (Uuid, PathBuf) {
        (self.profile.id, self.instance.clone())
    }
}

pub async fn write(path: &Path, body: &str) {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.unwrap();
    }
    tokio::fs::write(path, body).await.unwrap();
}

pub async fn read(path: &Path) -> Option<String> {
    tokio::fs::read_to_string(path).await.ok()
}

pub async fn touch_newer(path: &Path) {
    let meta = tokio::fs::metadata(path).await.unwrap();
    let bumped = meta.modified().unwrap() + std::time::Duration::from_secs(60);
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(bumped).unwrap();
    })
    .await
    .unwrap();
}

pub async fn touch_older(path: &Path) {
    let meta = tokio::fs::metadata(path).await.unwrap();
    let aged = meta.modified().unwrap() - std::time::Duration::from_secs(60);
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(aged).unwrap();
    })
    .await
    .unwrap();
}

fn test_profile(name: &str) -> Profile {
    Profile {
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
    }
}
