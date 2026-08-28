use crate::integrations::{curseforge, modrinth, unified_mod};
use crate::state::profile_state::{Mod, ModLoader, ModSource};
use crate::utils::hash_utils;
use log::{debug, info};
use std::path::Path;
use uuid::Uuid;

pub fn mod_from_modrinth_version(
    version: &modrinth::ModrinthVersion,
    sha1: Option<String>,
) -> Option<Mod> {
    let file = version
        .files
        .iter()
        .find(|entry| entry.primary)
        .or_else(|| version.files.first())?;

    Some(Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: version.project_id.clone(),
            version_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1.or_else(|| file.hashes.sha1.clone()),
        },
        enabled: true,
        display_name: Some(version.name.clone()),
        version: Some(version.version_number.clone()),
        game_versions: Some(version.game_versions.clone()),
        file_name_override: None,
        associated_loader: version
            .loaders
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    })
}

pub fn mod_from_curseforge_file(file: &curseforge::CurseForgeFile) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::CurseForge {
            project_id: file.modId.to_string(),
            file_id: file.id.to_string(),
            file_name: file.fileName.clone(),
            download_url: file.downloadUrl.clone(),
            file_hash_sha1: file
                .hashes
                .iter()
                .find(|hash| hash.algo == 1)
                .map(|hash| hash.value.clone()),
            file_fingerprint: Some(file.fileFingerprint),
        },
        enabled: true,
        display_name: Some(file.displayName.clone()),
        version: None,
        game_versions: Some(file.gameVersions.clone()),
        file_name_override: None,
        associated_loader: unified_mod::extract_loaders_from_game_versions(&file.gameVersions)
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    }
}

async fn modrinth_project_title(project_id: &str) -> Option<String> {
    modrinth::get_multiple_projects(vec![project_id.to_string()])
        .await
        .ok()?
        .into_iter()
        .next()
        .map(|project| project.title)
}

async fn curseforge_project_title(mod_id: u32) -> Option<String> {
    curseforge::get_mod_info(mod_id).await.ok().map(|m| m.name)
}

pub async fn identify_jar(path: &Path) -> Option<Mod> {
    let label = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());

    if let Ok(sha1) = hash_utils::calculate_sha1_from_file(path).await {
        match modrinth::get_version_by_hash(sha1.clone()).await {
            Ok(version) => {
                if let Some(mut entry) = mod_from_modrinth_version(&version, Some(sha1)) {
                    if let Some(title) = modrinth_project_title(&version.project_id).await {
                        entry.display_name = Some(title);
                    }
                    info!(
                        "Identified '{}' as Modrinth {}/{}",
                        label, version.project_id, version.id
                    );
                    return Some(entry);
                }
            }
            Err(e) => debug!("'{}' is not a known Modrinth file: {}", label, e),
        }
    }

    let fingerprint = hash_utils::calculate_curseforge_fingerprint(path).await.ok()?;
    let matches = curseforge::fingerprint_matches(vec![fingerprint]).await.ok()?;
    let (mod_id, file_id) = matches.get(&fingerprint).copied()?;
    let file = curseforge::get_file_details(mod_id, file_id).await.ok()?;

    info!(
        "Identified '{}' as CurseForge {}/{}",
        label, mod_id, file_id
    );

    let mut entry = mod_from_curseforge_file(&file);
    if let Some(title) = curseforge_project_title(mod_id).await {
        entry.display_name = Some(title);
    }
    Some(entry)
}

pub fn mod_from_unified_version(version: &unified_mod::UnifiedVersion) -> Option<Mod> {
    let file = version
        .files
        .iter()
        .find(|entry| entry.primary)
        .or_else(|| version.files.first())?;

    let sha1 = file.hashes.get("sha1").cloned();
    let source = match version.source {
        unified_mod::ModPlatform::Modrinth => ModSource::Modrinth {
            project_id: version.project_id.clone(),
            version_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1,
        },
        unified_mod::ModPlatform::CurseForge => ModSource::CurseForge {
            project_id: version.project_id.clone(),
            file_id: version.id.clone(),
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            file_hash_sha1: sha1,
            file_fingerprint: file.fingerprint,
        },
    };

    Some(Mod {
        id: Uuid::new_v4(),
        source,
        enabled: true,
        display_name: Some(version.name.clone()),
        version: Some(version.version_number.clone()),
        game_versions: Some(version.game_versions.clone()),
        file_name_override: None,
        associated_loader: version
            .loaders
            .iter()
            .find_map(|loader| ModLoader::from_str(loader).ok()),
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    })
}
