use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::integrations::modrinth;
use crate::integrations::mrpack::{
    ModrinthIndex, ModrinthIndexFile, FABRIC_LOADER_DEPENDENCY, FORGE_DEPENDENCY,
    MINECRAFT_DEPENDENCY, NEOFORGE_DEPENDENCY, QUILT_LOADER_DEPENDENCY,
};
use crate::minecraft::modloader::ModloaderFactory;
use crate::state::profile_state::{self, ModLoader, ModSource, Profile};
use crate::state::state_manager::State;
use crate::utils::hash_utils;
use crate::utils::import_safety::safe_file_component;
use crate::utils::profile_utils::{
    relative_zip_path, select_export_files, write_export_archive, ExportEntry,
};
use log::{info, warn};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

#[cfg(test)]
#[path = "mrpack_export_test.rs"]
mod tests;

const MOD_CACHE_DIR_NAME: &str = "mod_cache";
const DEFAULT_PACK_VERSION: &str = "1.0.0";
const INDEX_FILE_NAME: &str = "modrinth.index.json";
const OVERRIDES_MODS_PREFIX: &str = "overrides/mods/";

const NEVER_EXPORTABLE_PREFIXES: &[&str] = &[
    "profile.json",
    "logs/",
    "crash-reports/",
    ".fabric/",
    ".mixin.out/",
    "__MACOSX/",
];
const NEVER_EXPORTABLE_SUFFIXES: &[&str] = &[".DS_Store"];

pub async fn export_profile_to_mrpack(
    profile_id: Uuid,
    output_path: PathBuf,
    include_files: Option<Vec<PathBuf>>,
    version_id: Option<String>,
) -> Result<PathBuf> {
    info!("Exporting profile {} to .mrpack", profile_id);

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    let dependencies = build_dependencies(&state, &profile).await?;
    let (index_files, bundled_mod_filenames) =
        build_index_files(&state, &profile, &instance_path).await?;

    let entries = collect_entries(
        &state,
        &profile,
        &instance_path,
        include_files.as_ref(),
        &index_files,
        &bundled_mod_filenames,
    )
    .await?;

    let index = ModrinthIndex {
        format_version: 1,
        game: "minecraft".to_string(),
        version_id: version_id.unwrap_or_else(|| DEFAULT_PACK_VERSION.to_string()),
        name: profile.name.clone(),
        summary: profile.description.clone(),
        files: index_files,
        dependencies,
    };
    let index_json = serde_json::to_vec_pretty(&index)?;

    write_export_archive(
        &state,
        profile_id,
        &output_path,
        entries,
        vec![(INDEX_FILE_NAME.to_string(), index_json)],
    )
    .await?;

    info!(
        "Successfully exported profile to: {}",
        output_path.display()
    );
    Ok(output_path)
}

async fn build_dependencies(state: &State, profile: &Profile) -> Result<HashMap<String, String>> {
    let mut dependencies = HashMap::new();
    dependencies.insert(
        MINECRAFT_DEPENDENCY.to_string(),
        profile.game_version.clone(),
    );

    let loader_key = match profile.loader {
        ModLoader::Vanilla => None,
        ModLoader::Fabric => Some(FABRIC_LOADER_DEPENDENCY),
        ModLoader::Quilt => Some(QUILT_LOADER_DEPENDENCY),
        ModLoader::Forge => Some(FORGE_DEPENDENCY),
        ModLoader::NeoForge => Some(NEOFORGE_DEPENDENCY),
    };

    let Some(loader_key) = loader_key else {
        return Ok(dependencies);
    };

    let loader_version = match &profile.loader_version {
        Some(version) if !version.trim().is_empty() => version.clone(),
        _ => {
            let config = state.norisk_pack_manager.get_config().await;
            ModloaderFactory::resolve_loader_version(profile, &profile.game_version, Some(&config))
                .await
                .version
                .ok_or_else(|| {
                    AppError::Other(format!(
                        "Could not resolve a {} version for MC {} - .mrpack requires an exact loader version",
                        loader_key, profile.game_version
                    ))
                })?
        }
    };

    dependencies.insert(loader_key.to_string(), loader_version);
    Ok(dependencies)
}

async fn build_index_files(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
) -> Result<(Vec<ModrinthIndexFile>, Vec<String>)> {
    let mut candidates: Vec<(String, String)> = Vec::new();
    let mut bundled: Vec<String> = Vec::new();

    for mod_info in profile.mods.iter().filter(|m| m.enabled) {
        let raw_filename = match &mod_info.file_name_override {
            Some(name) => Ok(name.clone()),
            None => profile_state::get_profile_mod_filename(&mod_info.source),
        };
        let filename = match raw_filename.and_then(|name| safe_file_component(&name)) {
            Ok(name) => name,
            Err(e) => {
                warn!("Skipping mod without resolvable filename: {}", e);
                continue;
            }
        };

        let ModSource::Modrinth { file_hash_sha1, .. } = &mod_info.source else {
            bundled.push(filename);
            continue;
        };

        let sha1 = match file_hash_sha1 {
            Some(hash) if !hash.trim().is_empty() => Some(hash.to_lowercase()),
            _ => match locate_mod_jar(state, profile, instance_path, &filename).await {
                Some(jar) => hash_utils::calculate_sha1(&jar)
                    .await
                    .ok()
                    .map(|hash| hash.to_lowercase()),
                None => None,
            },
        };

        match sha1 {
            Some(hash) => candidates.push((hash, filename)),
            None => bundled.push(filename),
        }
    }

    if candidates.is_empty() {
        return Ok((Vec::new(), bundled));
    }

    let hashes: Vec<String> = candidates.iter().map(|(hash, _)| hash.clone()).collect();
    let versions = match modrinth::get_versions_by_hashes(hashes, "sha1").await {
        Ok(versions) => versions,
        Err(e) => {
            warn!(
                "Modrinth lookup failed ({}), bundling all Modrinth mods as overrides instead",
                e
            );
            bundled.extend(candidates.into_iter().map(|(_, filename)| filename));
            return Ok((Vec::new(), bundled));
        }
    };

    let mut index_files = Vec::new();
    for (sha1, filename) in candidates {
        let file = versions
            .get(&sha1)
            .and_then(|version| {
                version
                    .files
                    .iter()
                    .find(|f| f.primary)
                    .or_else(|| version.files.first())
            })
            .filter(|f| f.hashes.sha1.is_some() && f.hashes.sha512.is_some());

        let Some(file) = file else {
            warn!(
                "No Modrinth version with both sha1 and sha512 for '{}', bundling it as an override",
                filename
            );
            bundled.push(filename);
            continue;
        };

        let mut file_hashes = HashMap::new();
        if let Some(hash) = &file.hashes.sha1 {
            file_hashes.insert("sha1".to_string(), hash.clone());
        }
        if let Some(hash) = &file.hashes.sha512 {
            file_hashes.insert("sha512".to_string(), hash.clone());
        }

        let mut env = HashMap::new();
        env.insert("client".to_string(), "required".to_string());
        env.insert("server".to_string(), "required".to_string());

        index_files.push(ModrinthIndexFile {
            path: format!("mods/{}", filename),
            hashes: file_hashes,
            env: Some(env),
            downloads: vec![file.url.clone()],
            file_size: file.size,
        });
    }

    info!(
        "mrpack export: {} mods as index downloads, {} bundled as overrides",
        index_files.len(),
        bundled.len()
    );
    Ok((index_files, bundled))
}

async fn collect_entries(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
    include_files: Option<&Vec<PathBuf>>,
    index_files: &[ModrinthIndexFile],
    bundled_mod_filenames: &[String],
) -> Result<Vec<ExportEntry>> {
    let index_mod_filenames: HashSet<&str> = index_files
        .iter()
        .filter_map(|entry| entry.path.rsplit('/').next())
        .collect();

    let mut claimed_zip_paths: HashSet<String> = HashSet::new();
    let mut entries: Vec<ExportEntry> = Vec::new();

    for source_path in select_export_files(instance_path, include_files).await? {
        let Some(rel_path) = relative_zip_path(instance_path, &source_path) else {
            continue;
        };
        let Some(zip_path) = override_zip_path(&rel_path) else {
            continue;
        };
        if let Some(name) = zip_path.strip_prefix(OVERRIDES_MODS_PREFIX) {
            if index_mod_filenames.contains(name) {
                continue;
            }
        }
        if !claimed_zip_paths.insert(zip_path.clone()) {
            continue;
        }
        entries.push(ExportEntry {
            source_path,
            zip_path,
        });
    }

    for filename in bundled_mod_filenames {
        let zip_path = format!("{}{}", OVERRIDES_MODS_PREFIX, filename);
        if claimed_zip_paths.contains(&zip_path) {
            continue;
        }
        match locate_mod_jar(state, profile, instance_path, filename).await {
            Some(source_path) => {
                claimed_zip_paths.insert(zip_path.clone());
                entries.push(ExportEntry {
                    source_path,
                    zip_path,
                });
            }
            None => warn!(
                "Could not locate jar for mod '{}', it will be missing from the exported .mrpack",
                filename
            ),
        }
    }

    Ok(entries)
}

fn override_zip_path(rel_path: &str) -> Option<String> {
    let is_excluded = NEVER_EXPORTABLE_PREFIXES
        .iter()
        .any(|prefix| rel_path.starts_with(prefix))
        || NEVER_EXPORTABLE_SUFFIXES
            .iter()
            .any(|suffix| rel_path.ends_with(suffix));
    if is_excluded {
        return None;
    }

    let is_managed_mod = rel_path.starts_with("mods/nrc-") || rel_path.starts_with("custom_mods/");
    if is_managed_mod {
        let filename = rel_path.rsplit('/').next()?;
        return Some(format!("{}{}", OVERRIDES_MODS_PREFIX, filename));
    }

    Some(format!("overrides/{}", rel_path))
}

async fn locate_mod_jar(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
    filename: &str,
) -> Option<PathBuf> {
    let mut candidates = vec![instance_path.join("mods").join(filename)];
    if let Ok(managed_dir) = state.profile_manager.get_profile_mods_path(profile) {
        candidates.push(managed_dir.join(filename));
    }
    candidates.push(instance_path.join("custom_mods").join(filename));
    candidates.push(
        LAUNCHER_DIRECTORY
            .meta_dir()
            .join(MOD_CACHE_DIR_NAME)
            .join(filename),
    );

    for candidate in candidates {
        if fs::metadata(&candidate)
            .await
            .is_ok_and(|meta| meta.is_file())
        {
            return Some(candidate);
        }
    }
    None
}
