//! `modpack` — install a Modrinth modpack by project id and launch it.
//!
//! Thin CLI wrapper around the same install path the GUI's "Install" button uses:
//! resolve the project's newest matching version, download it into a fresh
//! profile, then launch that profile. Whether the pack actually works is judged
//! by whoever is watching — this only gets it running.

use crate::commands::modrinth_commands::{
    download_and_install_modrinth_modpack, get_modrinth_mod_versions,
};
use crate::commands::profile_command::{launch_profile_with_overrides, LaunchOverrides};
use crate::integrations::modrinth::{ModrinthVersion, ModrinthVersionType};
use log::{error, info};
use uuid::Uuid;

/// Parsed `modpack` invocation.
#[derive(Debug, Clone, Default)]
pub struct ModpackArgs {
    /// Modrinth project id or slug (e.g. `1KVo5zza` or `fabulously-optimized`).
    pub id: String,
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
    let versions: Vec<ModrinthVersion> = get_modrinth_mod_versions(
        args.id.clone(),
        args.loader.clone().map(|l| vec![l]),
        args.game_version.clone().map(|v| vec![v]),
        None,
    )
    .await
    .map_err(|e| format!("version lookup for '{}' failed: {:?}", args.id, e))?;

    // Modrinth returns versions newest-first. Without an explicit pin we take the
    // newest *release* — a pack's latest build is often an alpha/beta that its
    // author does not consider ready. Fall back to the newest of any type for
    // packs that never publish releases.
    let version = match &args.version {
        Some(wanted) => versions
            .into_iter()
            .find(|v| &v.id == wanted || &v.version_number == wanted)
            .ok_or_else(|| format!("version '{}' not found for '{}'", wanted, args.id))?,
        None => {
            let newest_release = versions
                .iter()
                .find(|v| matches!(v.version_type, ModrinthVersionType::Release))
                .cloned();
            match newest_release {
                Some(v) => v,
                None => versions
                    .into_iter()
                    .next()
                    .ok_or_else(|| format!("no matching version for '{}'", args.id))?,
            }
        }
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
