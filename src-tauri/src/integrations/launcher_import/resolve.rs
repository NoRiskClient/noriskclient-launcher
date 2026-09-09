use super::model::{DeclaredMod, ExternalInstance};
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::integrations::curseforge;
use crate::integrations::mod_lookup;
use crate::integrations::provenance::{ProvenanceReport, UnknownReason};
use crate::state::profile_state::{get_profile_mod_filename, Mod, ModLoader, ModSource};
use crate::utils::import_safety::{
    check_content_file_name, require_host, CURSEFORGE_HOSTS, MODRINTH_HOSTS,
};
use dashmap::DashMap;
use log::{debug, warn};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

const MAX_JARS: usize = 5000;
const SKIPPED_DIRS: &[&str] = &[".connector", ".index", ".cache", ".fabric", ".mixin.out"];

#[derive(Debug, Default)]
pub struct ResolvedMods {
    pub managed: Vec<Mod>,
    pub local: Vec<LocalJar>,
    pub jars: Vec<DiscoveredJar>,
    pub provenance: ProvenanceReport,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct LocalJar {
    pub source_path: PathBuf,
    pub file_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct DiscoveredJar {
    pub path: PathBuf,
    pub file_name: String,
    pub enabled: bool,
    pub bytes: u64,
}

pub fn strip_disabled(raw_name: &str) -> Option<(String, bool)> {
    let lower = raw_name.to_ascii_lowercase();

    if let Some(stem) = lower.strip_suffix(".disabled") {
        return stem
            .ends_with(".jar")
            .then(|| (raw_name[..raw_name.len() - ".disabled".len()].to_string(), false));
    }
    lower
        .ends_with(".jar")
        .then(|| (raw_name.to_string(), true))
}

async fn collect_jars_in(dir: &Path, out: &mut Vec<DiscoveredJar>, recurse: bool) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };

    let mut subdirs = Vec::new();

    while let Ok(Some(entry)) = entries.next_entry().await {
        if out.len() >= MAX_JARS {
            return;
        }

        let path = entry.path();
        let Some(raw_name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };

        let is_dir = entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false);

        if is_dir {
            if recurse && !SKIPPED_DIRS.contains(&raw_name.as_str()) {
                subdirs.push(path);
            }
            continue;
        }

        let Some((file_name, enabled)) = strip_disabled(&raw_name) else {
            continue;
        };
        if check_content_file_name(&file_name).is_err() {
            warn!("Skipping jar with an unsafe file name: '{}'", raw_name);
            continue;
        }

        let bytes = entry.metadata().await.map(|meta| meta.len()).unwrap_or(0);

        out.push(DiscoveredJar {
            path,
            file_name,
            enabled,
            bytes,
        });
    }

    for subdir in subdirs {
        Box::pin(collect_jars_in(&subdir, out, false)).await;
    }
}

pub async fn discover_jars(game_dir: &Path) -> (Vec<DiscoveredJar>, bool) {
    let mut jars = Vec::new();
    collect_jars_in(&game_dir.join("mods"), &mut jars, true).await;

    let truncated = jars.len() >= MAX_JARS;
    jars.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    (jars, truncated)
}

pub fn pin_to_profile(entry: &mut Mod, loader: ModLoader, game_version: &str) {
    entry.associated_loader = Some(loader);

    let mismatched = entry
        .game_versions
        .as_ref()
        .is_some_and(|versions| !versions.is_empty() && !versions.iter().any(|v| v == game_version));

    if mismatched && !entry.force_include_versions.iter().any(|v| v == game_version) {
        entry.force_include_versions.push(game_version.to_string());
    }
}

fn trusted_url(url: Option<&String>, hosts: &[&str], platform: &str) -> Option<String> {
    let url = url?;
    require_host(url, hosts, platform).ok().map(|_| url.clone())
}

fn mod_from_declared(declared: &DeclaredMod) -> Option<Mod> {
    let file_name = declared.file_name.clone();

    let source = if let Some((project_id, file_id)) = declared.curseforge {
        let download_url = trusted_url(
            declared.download_url.as_ref(),
            CURSEFORGE_HOSTS,
            "CurseForge",
        )?;

        ModSource::CurseForge {
            project_id: project_id.to_string(),
            file_id: file_id.to_string(),
            file_name,
            download_url,
            file_hash_sha1: declared.sha1.clone(),
            file_fingerprint: declared.fingerprint,
        }
    } else if let Some((project_id, version_id)) = declared.modrinth.clone() {
        let download_url = trusted_url(declared.download_url.as_ref(), MODRINTH_HOSTS, "Modrinth")?;

        ModSource::Modrinth {
            project_id,
            version_id,
            file_name,
            download_url,
            file_hash_sha1: declared.sha1.clone(),
        }
    } else {
        return None;
    };

    Some(Mod {
        id: Uuid::new_v4(),
        source,
        enabled: declared.enabled,
        display_name: declared.display_name.clone(),
        version: None,
        game_versions: declared.game_versions.clone(),
        file_name_override: None,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    })
}

async fn backfill_curseforge(file_ids: Vec<u32>) -> HashMap<u32, Mod> {
    let mut built = HashMap::new();
    if file_ids.is_empty() {
        return built;
    }

    for chunk in mod_lookup::chunk_unique(file_ids, mod_lookup::CURSEFORGE_FILE_BATCH) {
        match curseforge::get_files_by_ids(chunk).await {
            Ok(files) => {
                for file in files {
                    built.insert(file.id, mod_lookup::mod_from_curseforge_file(&file));
                }
            }
            Err(e) => warn!("CurseForge file backfill failed for one batch: {}", e),
        }
    }

    built
}

struct CacheEntry {
    fingerprint: String,
    resolved: Arc<ResolvedMods>,
}

static RESOLUTIONS: Lazy<DashMap<String, CacheEntry>> = Lazy::new(DashMap::new);

fn fingerprint(game_version: &str, jars: &[DiscoveredJar]) -> String {
    let total: u64 = jars.iter().map(|jar| jar.bytes).sum();
    let names: String = jars
        .iter()
        .map(|jar| format!("{}:{}", jar.file_name, jar.enabled))
        .collect::<Vec<_>>()
        .join("|");

    format!("{}#{}#{}#{}", game_version, jars.len(), total, names)
}

pub async fn resolve_instance_mods(
    instance: &ExternalInstance,
    game_version: &str,
) -> Arc<ResolvedMods> {
    let (jars, truncated) = discover_jars(&instance.game_dir).await;
    let cache_key = instance.game_dir.display().to_string();
    let current = fingerprint(game_version, &jars);

    if let Some(entry) = RESOLUTIONS.get(&cache_key) {
        if entry.fingerprint == current {
            debug!(
                "Reusing the resolution of '{}'",
                instance.reference.name
            );
            return entry.resolved.clone();
        }
    }

    let resolved = Arc::new(resolve_uncached(instance, game_version, jars, truncated).await);

    RESOLUTIONS.insert(
        cache_key,
        CacheEntry {
            fingerprint: current,
            resolved: resolved.clone(),
        },
    );

    resolved
}

async fn resolve_uncached(
    instance: &ExternalInstance,
    game_version: &str,
    jars: Vec<DiscoveredJar>,
    truncated: bool,
) -> ResolvedMods {
    let mut resolved = ResolvedMods {
        truncated,
        jars: jars.clone(),
        ..Default::default()
    };

    let to_local = |jar: DiscoveredJar| LocalJar {
        source_path: jar.path,
        file_name: jar.file_name,
        enabled: jar.enabled,
    };

    if instance.loader() == ModLoader::Vanilla {
        for jar in jars {
            let local = to_local(jar);
            resolved
                .provenance
                .push_unknown(local.file_name.clone(), UnknownReason::LocalSource);
            resolved.local.push(local);
        }
        return resolved;
    }

    let declared_by_name: HashMap<String, &DeclaredMod> = instance
        .declared_mods
        .iter()
        .map(|declared| (declared.file_name.to_ascii_lowercase(), declared))
        .collect();

    let mut unresolved: Vec<DiscoveredJar> = Vec::new();
    let mut pending_curseforge: Vec<(DiscoveredJar, u32)> = Vec::new();
    let mut pending_sha1: Vec<(DiscoveredJar, String)> = Vec::new();

    for jar in jars {
        let key = jar.file_name.to_ascii_lowercase();
        let Some(declared) = declared_by_name.get(&key) else {
            unresolved.push(jar);
            continue;
        };

        match mod_from_declared(declared) {
            Some(mut entry) => {
                entry.enabled = jar.enabled;
                pin_to_profile(&mut entry, instance.loader(), game_version);
                resolved.provenance.verified_count += 1;
                resolved.managed.push(entry);
            }
            None => match (declared.curseforge, declared.sha1.clone()) {
                (Some((_, file_id)), _) => pending_curseforge.push((jar, file_id)),
                (None, Some(sha1)) => pending_sha1.push((jar, sha1)),
                (None, None) => unresolved.push(jar),
            },
        }
    }

    if !pending_curseforge.is_empty() {
        let backfilled =
            backfill_curseforge(pending_curseforge.iter().map(|(_, id)| *id).collect()).await;

        for (jar, file_id) in pending_curseforge {
            match backfilled.get(&file_id) {
                Some(entry) => {
                    let mut entry = entry.clone();
                    entry.enabled = jar.enabled;
                    pin_to_profile(&mut entry, instance.loader(), game_version);
                    resolved.provenance.verified_count += 1;
                    resolved.managed.push(entry);
                }
                None => unresolved.push(jar),
            }
        }
    }

    debug!(
        "Instance '{}': {} mods from launcher metadata, {} with known hashes, {} jars left to hash",
        instance.reference.name,
        resolved.managed.len(),
        pending_sha1.len(),
        unresolved.len()
    );

    let mut identified: HashMap<PathBuf, Option<Mod>> = HashMap::new();
    let mut to_finish: Vec<DiscoveredJar> = Vec::new();

    if !pending_sha1.is_empty() {
        let entries: Vec<(PathBuf, String)> = pending_sha1
            .iter()
            .map(|(jar, sha1)| (jar.path.clone(), sha1.clone()))
            .collect();
        for identity in mod_lookup::identify_with_sha1(entries).await {
            identified.insert(identity.path, identity.resolved);
        }
        to_finish.extend(pending_sha1.into_iter().map(|(jar, _)| jar));
    }

    if !unresolved.is_empty() {
        let paths: Vec<PathBuf> = unresolved.iter().map(|jar| jar.path.clone()).collect();
        for identity in mod_lookup::identify_jars(&paths).await {
            identified.insert(identity.path, identity.resolved);
        }
        to_finish.extend(unresolved);
    }

    if !to_finish.is_empty() {
        for jar in to_finish {
            match identified.get(&jar.path).cloned().flatten() {
                Some(mut entry) => {
                    entry.enabled = jar.enabled;
                    pin_to_profile(&mut entry, instance.loader(), game_version);
                    resolved.provenance.verified_count += 1;
                    resolved.managed.push(entry);
                }
                None => {
                    let local = to_local(jar);
                    resolved
                        .provenance
                        .push_unknown(local.file_name.clone(), UnknownReason::NotOnPlatform);
                    resolved.local.push(local);
                }
            }
        }
    }

    if resolved.truncated {
        resolved.provenance.incomplete = true;
    }

    resolved
}

pub async fn seed_mod_cache(managed: &[Mod], jars: &[DiscoveredJar]) -> usize {
    let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("mod_cache");
    if tokio::fs::create_dir_all(&cache_dir).await.is_err() {
        return 0;
    }

    let lookup: HashMap<String, &PathBuf> = jars
        .iter()
        .map(|jar| (jar.file_name.to_ascii_lowercase(), &jar.path))
        .collect();

    let mut seeded = 0;
    let mut done: HashSet<String> = HashSet::new();

    for entry in managed {
        let Ok(target_name) = get_profile_mod_filename(&entry.source) else {
            continue;
        };
        let key = target_name.to_ascii_lowercase();
        if !done.insert(key.clone()) {
            continue;
        }
        let Some(source) = lookup.get(&key) else {
            continue;
        };

        let target = cache_dir.join(&target_name);
        if tokio::fs::try_exists(&target).await.unwrap_or(false) {
            continue;
        }
        match tokio::fs::copy(source, &target).await {
            Ok(_) => seeded += 1,
            Err(e) => warn!("Could not seed '{}' into the mod cache: {}", target_name, e),
        }
    }

    seeded
}
