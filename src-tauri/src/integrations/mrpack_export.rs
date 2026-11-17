use crate::error::Result;
use crate::integrations::modrinth;
use crate::integrations::mrpack::{
    ModrinthIndex, ModrinthIndexFile, FABRIC_LOADER_DEPENDENCY, FORGE_DEPENDENCY,
    MINECRAFT_DEPENDENCY, NEOFORGE_DEPENDENCY, QUILT_LOADER_DEPENDENCY,
};
use crate::state::profile_state::{ModLoader, ModSource, Profile};
use crate::state::state_manager::State;
use crate::utils::export_utils::{
    collect_export_entries, locate_mod_jar, mod_file_name, resolve_export_loader_version,
    write_export_archive,
};
use crate::utils::hash_utils;
use log::{info, warn};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const DEFAULT_PACK_VERSION: &str = "1.0.0";
const INDEX_FILE_NAME: &str = "modrinth.index.json";

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

    let indexed_mod_filenames: HashSet<String> = index_files
        .iter()
        .filter_map(|entry| entry.path.rsplit('/').next().map(|name| name.to_string()))
        .collect();
    let entries = collect_export_entries(
        &state,
        &profile,
        &instance_path,
        include_files.as_ref(),
        &indexed_mod_filenames,
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

    let loader_version = resolve_export_loader_version(state, profile, ".mrpack").await?;

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
        let Some(filename) = mod_file_name(mod_info) else {
            continue;
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

