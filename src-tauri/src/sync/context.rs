use crate::error::Result;
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use crate::state::sync_pack_state::SyncPackManager;
use crate::sync::model::{SyncPack, SyncTarget};
use crate::sync::paths;
use crate::sync::report::{PreviewAction, SyncPreviewEntry};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

pub struct SyncContext<'a> {
    pub pack: &'a SyncPack,
    pub target: &'a SyncTarget,
    pub profile: &'a Profile,
    pub instance_dir: &'a Path,
    pub subscriber_instances: &'a [(Uuid, PathBuf)],
    pub linked_dirs: &'a HashSet<String>,
    pub instance_shared_with_other_subscriber: bool,
    pub manager: &'a SyncPackManager,
    pub io_semaphore: Arc<Semaphore>,
}

impl<'a> SyncContext<'a> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pack: &'a SyncPack,
        target: &'a SyncTarget,
        profile: &'a Profile,
        instance_dir: &'a Path,
        subscriber_instances: &'a [(Uuid, PathBuf)],
        linked_dirs: &'a HashSet<String>,
        instance_shared_with_other_subscriber: bool,
        state: &'a State,
    ) -> Self {
        Self {
            pack,
            target,
            profile,
            instance_dir,
            subscriber_instances,
            linked_dirs,
            instance_shared_with_other_subscriber,
            manager: &state.sync_pack_manager,
            io_semaphore: Arc::clone(&state.io_semaphore),
        }
    }

    pub fn master_path(&self) -> Result<PathBuf> {
        if let Some(external) = self.target.external_path.as_deref() {
            if !external.is_empty() {
                return Ok(PathBuf::from(external));
            }
        }
        paths::master_path_for(self.pack.id, &self.target.path)
    }

    pub fn instance_path(&self) -> Result<PathBuf> {
        paths::instance_path_for(self.instance_dir, &self.target.path)
    }

    pub fn subscriber_target_paths(&self) -> Vec<(Uuid, PathBuf)> {
        self.subscriber_instances
            .iter()
            .filter_map(|(id, dir)| {
                paths::instance_path_for(dir, &self.target.path)
                    .ok()
                    .map(|p| (*id, p))
            })
            .collect()
    }

    pub fn preview_entry(&self, action: PreviewAction) -> SyncPreviewEntry {
        SyncPreviewEntry::new(
            self.pack.id,
            &self.pack.name,
            &self.target.path,
            self.target.kind.discriminant(),
            action,
        )
    }

    pub fn is_dir_linked(&self, path: &str) -> bool {
        self.linked_dirs.contains(path)
    }
}
