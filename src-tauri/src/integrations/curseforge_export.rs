use crate::error::Result;
use crate::integrations::curseforge::{
    self, CurseForgeManifest, CurseForgeManifestFile, CurseForgeMinecraft, CurseForgeModLoader,
    CURSEFORGE_FINGERPRINT_BATCH,
};
use crate::state::profile_state::{ModLoader, ModSource, Profile};
use crate::state::state_manager::State;
use crate::utils::export_utils::{
    collect_export_entries, locate_mod_jar, mod_file_name, resolve_export_loader_version,
    write_export_archive, OVERRIDES_DIR_NAME,
};
use crate::utils::hash_utils;
use futures::future::join_all;
use log::{info, warn};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

const DEFAULT_PACK_VERSION: &str = "1.0.0";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const MODLIST_FILE_NAME: &str = "modlist.html";
const MAX_FINGERPRINT_CANDIDATES: usize = 500;
const MAX_FINGERPRINT_FILE_BYTES: u64 = 200 * 1024 * 1024;

pub struct IndexEntry {
    pub project_id: u32,
    pub file_id: u32,
    pub file_name: String,
    pub display_name: Option<String>,
}

pub async fn export_profile_to_curseforge(
    profile_id: Uuid,
    output_path: PathBuf,
    include_files: Option<Vec<PathBuf>>,
    version: Option<String>,
) -> Result<PathBuf> {
    info!("Exporting profile {} to CurseForge zip", profile_id);

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    let mod_loaders = build_mod_loaders(&state, &profile).await?;
    let (index_entries, bundled_mod_filenames, indexed_mod_filenames) =
        build_index_entries(&state, &profile, &instance_path).await?;

    let entries = collect_export_entries(
        &state,
        &profile,
        &instance_path,
        include_files.as_ref(),
        &indexed_mod_filenames,
        &bundled_mod_filenames,
    )
    .await?;

    let manifest = CurseForgeManifest {
        minecraft: CurseForgeMinecraft {
            version: profile.game_version.clone(),
            mod_loaders,
            recommended_ram: None,
        },
        manifest_type: "minecraftModpack".to_string(),
        manifest_version: 1,
        name: profile.name.clone(),
        version: Some(version.unwrap_or_else(|| DEFAULT_PACK_VERSION.to_string())),
        author: None,
        description: profile.description.clone(),
        files: index_entries
            .iter()
            .map(|entry| CurseForgeManifestFile {
                project_id: entry.project_id,
                file_id: entry.file_id,
                required: true,
            })
            .collect(),
        overrides: Some(OVERRIDES_DIR_NAME.to_string()),
    };

    let manifest_json = serde_json::to_vec_pretty(&manifest)?;
    let modlist = render_modlist(&index_entries).into_bytes();

    write_export_archive(
        &state,
        profile_id,
        &output_path,
        entries,
        vec![
            (MANIFEST_FILE_NAME.to_string(), manifest_json),
            (MODLIST_FILE_NAME.to_string(), modlist),
        ],
    )
    .await?;

    info!(
        "Successfully exported profile to: {}",
        output_path.display()
    );
    Ok(output_path)
}

async fn build_mod_loaders(
    state: &State,
    profile: &Profile,
) -> Result<Vec<CurseForgeModLoader>> {
    if profile.loader == ModLoader::Vanilla {
        return Ok(Vec::new());
    }

    if profile.loader == ModLoader::Quilt {
        warn!("Exporting a Quilt profile as a CurseForge pack - the CurseForge app cannot install Quilt");
    }

    let loader_version = resolve_export_loader_version(state, profile, "a CurseForge pack").await?;
    Ok(vec![CurseForgeModLoader {
        id: curseforge_loader_id(profile.loader, &profile.game_version, &loader_version),
        primary: Some(true),
    }])
}

pub fn curseforge_loader_id(loader: ModLoader, game_version: &str, loader_version: &str) -> String {
    match loader {
        ModLoader::NeoForge if game_version == "1.20.1" => {
            format!("neoforge-1.20.1-{}", loader_version)
        }
        _ => format!("{}-{}", loader.as_str(), loader_version),
    }
}

async fn build_index_entries(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
) -> Result<(Vec<IndexEntry>, Vec<String>, HashSet<String>)> {
    let mut entries: Vec<IndexEntry> = Vec::new();
    let mut bundled: Vec<String> = Vec::new();
    let mut candidates: Vec<(String, Option<String>)> = Vec::new();

    for mod_info in profile.mods.iter().filter(|m| m.enabled) {
        let Some(filename) = mod_file_name(mod_info) else {
            continue;
        };

        match &mod_info.source {
            ModSource::CurseForge {
                project_id,
                file_id,
                ..
            } => match (project_id.parse::<u32>(), file_id.parse::<u32>()) {
                (Ok(project_id), Ok(file_id)) => entries.push(IndexEntry {
                    project_id,
                    file_id,
                    file_name: filename,
                    display_name: mod_info.display_name.clone(),
                }),
                _ => {
                    warn!(
                        "CurseForge mod '{}' has unparseable ids, bundling it instead",
                        filename
                    );
                    bundled.push(filename);
                }
            },
            ModSource::Embedded { .. } => {}
            _ => candidates.push((filename, mod_info.display_name.clone())),
        }
    }

    if candidates.len() > MAX_FINGERPRINT_CANDIDATES {
        warn!(
            "Only fingerprinting the first {} of {} mods, the rest is bundled",
            MAX_FINGERPRINT_CANDIDATES,
            candidates.len()
        );
        for (filename, _) in candidates.split_off(MAX_FINGERPRINT_CANDIDATES) {
            bundled.push(filename);
        }
    }

    resolve_candidates_via_fingerprint(
        state,
        profile,
        instance_path,
        candidates,
        &mut entries,
        &mut bundled,
    )
    .await;

    let mut claimed_filenames: HashSet<String> =
        entries.iter().map(|entry| entry.file_name.clone()).collect();

    let mut seen_projects: HashSet<u32> = HashSet::new();
    entries.retain(|entry| {
        if seen_projects.insert(entry.project_id) {
            true
        } else {
            warn!(
                "Dropping duplicate CurseForge project {} ({})",
                entry.project_id, entry.file_name
            );
            false
        }
    });

    claimed_filenames.retain(|name| !bundled.iter().any(|bundled_name| bundled_name == name));

    info!(
        "CurseForge export: {} mods in the manifest, {} bundled as overrides",
        entries.len(),
        bundled.len()
    );
    Ok((entries, bundled, claimed_filenames))
}

async fn resolve_candidates_via_fingerprint(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
    candidates: Vec<(String, Option<String>)>,
    entries: &mut Vec<IndexEntry>,
    bundled: &mut Vec<String>,
) {
    if candidates.is_empty() {
        return;
    }

    for (chunk_index, chunk) in candidates.chunks(CURSEFORGE_FINGERPRINT_BATCH).enumerate() {
        let mut fingerprinted: Vec<(u64, String, Option<String>)> = Vec::new();
        let mut unresolved: Vec<String> = Vec::new();

        let hashed = join_all(chunk.iter().map(|(filename, display_name)| {
            let filename = filename.clone();
            let display_name = display_name.clone();
            let semaphore = state.io_semaphore.clone();
            async move {
                let jar = locate_mod_jar(state, profile, instance_path, &filename).await?;
                let permit = semaphore.acquire().await.ok()?;
                let size = fs::metadata(&jar).await.ok()?.len();
                if size > MAX_FINGERPRINT_FILE_BYTES {
                    return None;
                }
                let fingerprint = hash_utils::calculate_curseforge_fingerprint(&jar).await.ok();
                drop(permit);
                fingerprint.map(|fingerprint| (fingerprint, filename, display_name))
            }
        }))
        .await;

        for (result, (filename, _)) in hashed.into_iter().zip(chunk.iter()) {
            match result {
                Some(entry) => fingerprinted.push(entry),
                None => unresolved.push(filename.clone()),
            }
        }

        bundled.extend(unresolved);
        if fingerprinted.is_empty() {
            continue;
        }

        let prints: Vec<u64> = fingerprinted.iter().map(|(print, _, _)| *print).collect();
        match curseforge::fingerprint_matches(prints).await {
            Ok(matches) => {
                for (fingerprint, filename, display_name) in fingerprinted {
                    match matches.get(&fingerprint) {
                        Some((project_id, file_id)) => entries.push(IndexEntry {
                            project_id: *project_id,
                            file_id: *file_id,
                            file_name: filename,
                            display_name,
                        }),
                        None => bundled.push(filename),
                    }
                }
            }
            Err(e) => {
                warn!(
                    "CurseForge fingerprint lookup failed ({}), bundling the remaining mods",
                    e
                );
                bundled.extend(fingerprinted.into_iter().map(|(_, filename, _)| filename));
                let processed = (chunk_index + 1) * CURSEFORGE_FINGERPRINT_BATCH;
                bundled.extend(
                    candidates
                        .iter()
                        .skip(processed)
                        .map(|(filename, _)| filename.clone()),
                );
                return;
            }
        }
    }
}

pub fn render_modlist(entries: &[IndexEntry]) -> String {
    let mut html = String::from("<ul>\n");
    for entry in entries {
        let label = entry.display_name.as_deref().unwrap_or(&entry.file_name);
        html.push_str(&format!(
            "<li><a href=\"https://www.curseforge.com/projects/{}\">{}</a></li>\n",
            entry.project_id,
            escape_html(label)
        ));
    }
    html.push_str("</ul>\n");
    html
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}
