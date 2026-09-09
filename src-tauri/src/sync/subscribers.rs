use crate::minecraft::launch::version::compare_versions;
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct Subscriber {
    pub profile: Profile,
    pub instance_dir: PathBuf,
    pub canonical: PathBuf,
}

pub async fn canonical_of(path: &Path) -> PathBuf {
    tokio::fs::canonicalize(path)
        .await
        .unwrap_or_else(|_| path.to_path_buf())
}

pub async fn of_pack(state: &State, pack_id: Uuid) -> Vec<Subscriber> {
    let profiles = state.profile_manager.profiles_subscribed_to(pack_id).await;

    let mut out = Vec::new();
    for profile in profiles {
        let Ok(instance_dir) = state
            .profile_manager
            .calculate_instance_path_for_profile(&profile)
        else {
            continue;
        };
        let canonical = canonical_of(&instance_dir).await;
        out.push(Subscriber {
            profile,
            instance_dir,
            canonical,
        });
    }

    out
}

pub fn unique_instances(subscribers: &[Subscriber]) -> Vec<(Uuid, PathBuf)> {
    let mut seen: HashSet<&Path> = HashSet::new();
    subscribers
        .iter()
        .filter(|s| seen.insert(s.canonical.as_path()))
        .map(|s| (s.profile.id, s.instance_dir.clone()))
        .collect()
}

pub fn shares_instance_with_other(
    subscribers: &[Subscriber],
    profile_id: Uuid,
    canonical: &Path,
) -> bool {
    subscribers
        .iter()
        .any(|s| s.profile.id != profile_id && s.canonical == canonical)
}

pub fn contexts(subscribers: &[Subscriber]) -> Vec<(String, ModLoader)> {
    let mut out: Vec<(String, ModLoader)> = Vec::new();
    for subscriber in subscribers {
        let entry = (
            subscriber.profile.game_version.clone(),
            subscriber.profile.loader,
        );
        if !out.contains(&entry) {
            out.push(entry);
        }
    }
    sort_contexts(&mut out);
    out
}

pub fn sort_contexts(contexts: &mut [(String, ModLoader)]) {
    contexts.sort_by(|a, b| {
        compare_versions(&b.0, &a.0).then_with(|| a.1.as_str().cmp(b.1.as_str()))
    });
}
