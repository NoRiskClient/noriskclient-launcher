//! `modpack` — install a modpack by project id and launch it.
//!
//! Thin CLI wrapper around the same install path the GUI's "Install" button uses:
//! resolve the project's newest matching version, download it into a fresh
//! profile, then launch that profile. Whether the pack actually works is judged
//! by whoever is watching — this only gets it running.

use crate::commands::modrinth_commands::{
    download_and_install_modrinth_modpack, get_modrinth_mod_versions,
};
use crate::commands::profile_command::{launch_profile_with_overrides, LaunchOverrides};
use crate::integrations::curseforge;
use crate::integrations::modrinth::{ModrinthVersion};
use log::{error, info};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum PackSource {
    #[default]
    Modrinth,
    CurseForge,
}

impl PackSource {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.to_lowercase().as_str() {
            "modrinth" | "mr" => Ok(Self::Modrinth),
            "curseforge" | "cf" => Ok(Self::CurseForge),
            other => Err(format!("unknown source '{}' (modrinth or curseforge)", other)),
        }
    }
}

/// Parsed `modpack` invocation.
#[derive(Debug, Clone, Default)]
pub struct ModpackArgs {
    /// Project id or slug (e.g. `1KVo5zza`, `fabulously-optimized` or `1272598`).
    pub id: String,
    pub source: PackSource,
    /// Pin an exact version id; otherwise the newest matching one is used.
    pub version: Option<String>,
    /// Narrow the version lookup.
    pub game_version: Option<String>,
    pub loader: Option<String>,
    /// Install only — don't launch afterwards.
    pub no_launch: bool,
}

pub async fn run_modpack(args: ModpackArgs) {
    match install_and_launch(&args).await {
        Ok(profile_id) => {
            println!("[modpack] profile {}", profile_id);
            info!("[modpack] done: profile {}", profile_id);
        }
        Err(e) => {
            println!("[modpack] FAILED: {}", e);
            error!("[modpack] {}", e);
        }
    }
}

async fn install_and_launch(args: &ModpackArgs) -> Result<Uuid, String> {
    let profile_id = match args.source {
        PackSource::Modrinth => install_from_modrinth(args).await?,
        PackSource::CurseForge => install_from_curseforge(args).await?,
    };

    if args.no_launch {
        println!("[modpack] installed, not launching (--no-launch)");
        return Ok(profile_id);
    }

    println!("[modpack] launching {}", profile_id);
    launch_profile_with_overrides(
        profile_id.to_string(),
        LaunchOverrides::default(),
        None,
        None,
        Vec::new(),
        None,
    )
    .await
    .map_err(|e| format!("launch failed: {:?}", e))?;

    Ok(profile_id)
}

async fn resolve_curseforge_project(id: &str) -> Result<u32, String> {
    if let Ok(numeric) = id.parse::<u32>() {
        return Ok(numeric);
    }

    curseforge::find_project_by_slug(id, 4471)
        .await
        .map_err(|e| format!("slug lookup for '{}' failed: {:?}", id, e))?
        .ok_or_else(|| format!("no CurseForge modpack with slug '{}'", id))
}

async fn install_from_curseforge(args: &ModpackArgs) -> Result<Uuid, String> {
    let project_id = resolve_curseforge_project(&args.id).await?;

    let files = curseforge::get_mod_files(
        project_id,
        args.game_version.clone(),
        None,
        None,
        None,
        Some(50),
    )
    .await
    .map_err(|e| format!("file lookup for '{}' failed: {:?}", args.id, e))?;

    let file = match &args.version {
        Some(wanted) => files
            .data
            .into_iter()
            .find(|f| f.id.to_string() == *wanted || f.displayName == *wanted)
            .ok_or_else(|| format!("version '{}' not found for '{}'", wanted, args.id))?,
        None => files
            .data
            .into_iter()
            .max_by(|a, b| a.fileDate.cmp(&b.fileDate))
            .ok_or_else(|| format!("no files for '{}'", args.id))?,
    };

    if file.downloadUrl.trim().is_empty() {
        return Err(format!(
            "'{}' does not allow third-party downloads",
            file.fileName
        ));
    }

    println!(
        "[modpack] installing {} ({}) for MC {}",
        file.fileName,
        file.id,
        file.gameVersions.join("/")
    );

    curseforge::download_and_install_curseforge_modpack(
        project_id,
        file.id,
        file.fileName.clone(),
        file.downloadUrl.clone(),
        None,
        None,
    )
    .await
    .map_err(|e| format!("install failed: {:?}", e))
}

async fn install_from_modrinth(args: &ModpackArgs) -> Result<Uuid, String> {
    let versions: Vec<ModrinthVersion> = get_modrinth_mod_versions(
        args.id.clone(),
        args.loader.clone().map(|l| vec![l]),
        args.game_version.clone().map(|v| vec![v]),
        None,
    )
    .await
    .map_err(|e| format!("version lookup for '{}' failed: {:?}", args.id, e))?;

    // Modrinth returns versions newest-first, and the newest of any type is what the pack page
    // offers and the Modrinth app installs. Preferring a release picks whatever the author last
    // marked stable, which for a pack that has moved on to alphas is a years-old build on an
    // older Minecraft — a different pack than the one being asked for.
    let version = match &args.version {
        Some(wanted) => versions
            .into_iter()
            .find(|v| &v.id == wanted || &v.version_number == wanted)
            .ok_or_else(|| format!("version '{}' not found for '{}'", wanted, args.id))?,
        None => versions
            .into_iter()
            .next()
            .ok_or_else(|| format!("no matching version for '{}'", args.id))?,
    };

    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .cloned()
        .ok_or_else(|| format!("version '{}' has no files", version.version_number))?;

    println!(
        "[modpack] installing {} ({}, {:?}) for MC {}",
        file.filename,
        version.version_number,
        version.version_type,
        version.game_versions.join("/")
    );
    let profile_id = download_and_install_modrinth_modpack(
        version.project_id.clone(),
        version.id.clone(),
        file.filename.clone(),
        file.url.clone(),
        None,
        Some(file.size),
        None,
    )
    .await
    .map_err(|e| format!("install failed: {:?}", e))?;

    Ok(profile_id)
}
