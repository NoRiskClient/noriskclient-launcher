use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::api::NoRiskApi;
use crate::minecraft::auth::minecraft_auth::Credentials;
use crate::minecraft::dto::norisk_meta::NoriskAssets;
use crate::minecraft::launch::launch_summary::DownloadStats;
use crate::state::event_state::{EventPayload, EventType, ProgressThrottle};
use crate::state::profile_state::Profile;
use crate::state::State;
use crate::utils::file_utils::{scan_object_store, write_atomic};
use futures::stream::{self, StreamExt};
use log::{debug, error, info, trace, warn};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const ASSETS_DIR: &str = "assets";
const NORISK_ASSETS_DIR: &str = "noriskclient";
const DEFAULT_CONCURRENT_DOWNLOADS: usize = 12;

/// Packs whose in-game NRC client owns regular asset management. For these the
/// launcher skips its own download/copy/cleanup of non-override entries and
/// passes `-Dnrc.assets.{dir,bucket}` so the client takes over. Every other
/// pack runs the legacy launcher-side asset pipeline.
const CLIENT_MANAGED_PACKS: &[&str] = &[
    "nrc-nightly",
    "nrc-standalone",
    "nrc-mini",
    "verity-nexus",
    "verity-emote",
];

/// `true` when the given (effective) pack id is client-managed — see
/// `CLIENT_MANAGED_PACKS`. `overrides/` entries are always kept regardless,
/// they land in the profile game dir which the client doesn't manage.
pub fn client_managed_assets(pack_id: &str) -> bool {
    CLIENT_MANAGED_PACKS.contains(&pack_id)
}

pub struct NoriskClientAssetsDownloadService {
    base_path: PathBuf,
    concurrent_downloads: usize,
    stats: Option<Arc<DownloadStats>>,
}

impl NoriskClientAssetsDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(ASSETS_DIR);
        trace!(
            "[NRC Assets Service] Initialized. Base Path: {}",
            base_path.display()
        );
        Self {
            base_path,
            concurrent_downloads: DEFAULT_CONCURRENT_DOWNLOADS,
            stats: None,
        }
    }

    pub fn with_stats(mut self, stats: Arc<DownloadStats>) -> Self {
        self.stats = Some(stats);
        self
    }

    /// Sets the number of concurrent downloads to use
    pub fn with_concurrent_downloads(mut self, concurrent_downloads: usize) -> Self {
        self.concurrent_downloads = concurrent_downloads;
        self
    }

    /// Downloads NoRisk client assets for a specific profile, processing the main pack
    /// and any additional asset groups defined in the pack configuration.
    pub async fn download_nrc_assets_for_profile(
        &self,
        profile: &Profile,
        credentials: Option<&Credentials>,
        is_experimental: bool,
    ) -> Result<()> {
        let state = State::get().await?;
        let game_directory = state
            .profile_manager
            .calculate_instance_path_for_profile(profile)?;

        // Use profile's effective pack as the *main* pack ID (honors rollout alias)
        let main_pack_id = match profile.effective_norisk_pack_id().await {
            Some(pack_id) if !pack_id.is_empty() => {
                info!(
                    "[NRC Assets Download] Using main pack ID from profile: {}",
                    pack_id
                );
                pack_id
            }
            _ => {
                info!(
                    "[NRC Assets Download] No pack specified in profile, skipping asset download"
                );
                return Ok(());
            }
        };

        let client_managed = client_managed_assets(&main_pack_id);
        info!(
            "[NRC Assets Download] Pack '{}' client-managed assets: {}",
            main_pack_id, client_managed
        );

        let creds = match credentials {
            Some(c) => c,
            None => {
                warn!("[NRC Assets Download] No credentials provided, skipping asset download");
                return Ok(());
            }
        };

        let token_ref = if is_experimental {
            info!("[NRC Assets Download] Using experimental token");
            &creds.norisk_credentials.experimental
        } else {
            info!("[NRC Assets Download] Using production token");
            &creds.norisk_credentials.production
        };

        let norisk_token = match token_ref {
            Some(token) => token.value.clone(),
            None => {
                warn!("[NRC Assets Download] No valid NoRisk token found for {} mode, skipping asset download",
                      if is_experimental { "experimental" } else { "production" });
                return Ok(());
            }
        };

        let request_uuid = creds.id.to_string();
        info!(
            "[NRC Assets Download] Using request UUID from credentials: {}",
            request_uuid
        );

        // --- Get Resolved Pack Definition ---
        info!("[NRC Assets Download] Getting Norisk packs config...");
        let norisk_packs_config = state.norisk_pack_manager.get_config().await;

        info!(
            "[NRC Assets Download] Resolving pack definition for main pack: {}",
            main_pack_id
        );
        let resolved_pack_definition = norisk_packs_config
            .get_resolved_pack_definition(&main_pack_id)
            .map_err(|e| {
                error!(
                    "Failed to get resolved pack definition for '{}': {}",
                    main_pack_id, e
                );
                AppError::Other(format!(
                    "Failed to resolve pack definition {}: {}",
                    main_pack_id, e
                ))
            })?;

        // --- Collect All Asset Groups to Process ---
        let mut asset_ids_to_process = vec![];
        asset_ids_to_process.extend(resolved_pack_definition.assets.iter().cloned());
        let unique_asset_ids: Vec<String> = {
            let mut seen = HashSet::new();
            asset_ids_to_process
                .into_iter()
                .filter(|id| seen.insert(id.clone()))
                .collect()
        };

        info!(
            "[NRC Assets Download] Identified asset groups to process: {:?}",
            unique_asset_ids
        );
        let total_groups = unique_asset_ids.len();

        self.emit_progress_event(
            &state,
            profile.id,
            &format!(
                "Starting NoRiskClient asset processing for {} groups...",
                total_groups
            ),
            0.01,
            None,
        )
        .await?;

        // --- Process Each Asset Group ---
        for (index, asset_id) in unique_asset_ids.iter().enumerate() {
            let group_progress_start = (index as f64 / total_groups as f64) * 0.9 + 0.01; // Scale 0.01 to 0.91
            let group_progress_end = ((index + 1) as f64 / total_groups as f64) * 0.9 + 0.01;

            info!(
                "--- Processing Asset Group {}/{} ('{}') ---",
                index + 1,
                total_groups,
                asset_id
            );

            match self
                .process_asset_group(
                    &state,
                    profile.id,
                    asset_id,
                    &norisk_token,
                    &request_uuid,
                    is_experimental,
                    client_managed,
                    &game_directory,
                    group_progress_start,
                    group_progress_end,
                )
                .await
            {
                Ok(()) => {
                    info!(
                        "--- Successfully finished processing asset group '{}' ---",
                        asset_id
                    );
                }
                Err(e) => {
                    error!(
                        "--- Error processing asset group '{}': {}. Continuing... ---",
                        asset_id, e
                    );
                    self.emit_progress_event(
                        &state,
                        profile.id,
                        &format!("Error processing asset group: {}", asset_id),
                        group_progress_end,
                        Some(e.to_string()),
                    )
                    .await?;
                }
            }
        }

        // --- Final Progress Update ---
        info!("[NRC Assets Download] All asset groups processed.");
        self.emit_progress_event(
            &state,
            profile.id,
            "NoRiskClient assets processing completed!",
            1.0,
            None,
        )
        .await?;

        Ok(())
    }

    fn manifest_path(&self, asset_id: &str, is_experimental: bool) -> PathBuf {
        self.base_path
            .join(NORISK_ASSETS_DIR)
            .join(asset_id)
            .join(format!(
                "manifest_{}.json",
                if is_experimental { "exp" } else { "prod" }
            ))
    }

    async fn cache_manifest(&self, path: &Path, assets: &NoriskAssets) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        write_atomic(path, serde_json::to_vec(assets)?).await
    }

    async fn fetch_manifest(
        &self,
        asset_id: &str,
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<NoriskAssets> {
        let path = self.manifest_path(asset_id, is_experimental);

        match NoRiskApi::norisk_assets(asset_id, norisk_token, request_uuid, is_experimental).await {
            Ok(assets) => {
                if let Err(e) = self.cache_manifest(&path, &assets).await {
                    warn!(
                        "[NRC Assets Group '{}'] Failed to cache manifest: {}",
                        asset_id, e
                    );
                }
                Ok(assets)
            }
            Err(e) => match Self::read_manifest(&path).await {
                Some(assets) => {
                    warn!(
                        "[NRC Assets Group '{}'] Backend unreachable ({}); using cached manifest {:?}",
                        asset_id, e, path
                    );
                    Ok(assets)
                }
                None => Err(e),
            },
        }
    }

    async fn read_manifest(path: &Path) -> Option<NoriskAssets> {
        let bytes = fs::read(path).await.ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// Processes a single asset group: Fetches metadata, downloads assets, copies to game dir.
    async fn process_asset_group(
        &self,
        state: &State,
        profile_id: Uuid,
        asset_id: &str,
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
        client_managed: bool,
        game_directory: &PathBuf,
        progress_start: f64,
        progress_end: f64,
    ) -> Result<()> {
        let progress_range = progress_end - progress_start;

        // 1. Fetch assets
        self.emit_progress_event(
            state,
            profile_id,
            &format!("Fetching assets for group: {}...", asset_id),
            progress_start + progress_range * 0.05,
            None,
        )
        .await?;

        let assets =
            match measure_time!(format!("NRC API call '{}'", asset_id), self.fetch_manifest(asset_id, norisk_token, request_uuid, is_experimental)
                .await)
            {
                Ok(fetched_assets) => {
                    info!(
                        "[NRC Assets Group '{}'] Assets fetched successfully. Found {} objects.",
                        asset_id,
                        fetched_assets.objects.len()
                    );
                    if fetched_assets.objects.is_empty() {
                        warn!(
                            "[NRC Assets Group '{}'] No assets found. Skipping download/copy.",
                            asset_id
                        );
                        self.emit_progress_event(
                            state,
                            profile_id,
                            &format!("No assets found for group: {}", asset_id),
                            progress_end,
                            None,
                        )
                        .await?;
                        return Ok(());
                    }
                    if let Some((key, obj)) = fetched_assets.objects.iter().next() {
                        debug!(
                            "[NRC Assets Group '{}'] Sample asset - Key: {}, Hash: {}, Size: {}",
                            asset_id, key, obj.hash, obj.size
                        );
                    }
                    fetched_assets
                }
                Err(e) => {
                    error!(
                        "[NRC Assets Group '{}'] Failed to fetch assets: {}. Skipping.",
                        asset_id, e
                    );
                    self.emit_progress_event(
                        state,
                        profile_id,
                        &format!("Failed to fetch assets for group: {}", asset_id),
                        progress_start + progress_range * 0.1,
                        Some(e.to_string()),
                    )
                    .await?;
                    return Err(AppError::Download(format!(
                        "Failed to fetch assets for {}: {}",
                        asset_id, e
                    )));
                }
            };

        // Client-managed mode: in-game client owns the regular asset cache, we
        // only keep `overrides/` entries (those land in the profile game dir).
        let assets = if client_managed {
            let total = assets.objects.len();
            let mut filtered = assets;
            filtered.objects.retain(|name, _| name.starts_with("overrides/"));
            info!(
                "[NRC Assets Group '{}'] client-managed mode: kept {} override entries (of {}); regular assets handled by in-game client",
                asset_id,
                filtered.objects.len(),
                total,
            );
            if filtered.objects.is_empty() {
                self.emit_progress_event(
                    state,
                    profile_id,
                    &format!("Group '{}' fully client-managed — no overrides", asset_id),
                    progress_end,
                    None,
                )
                .await?;
                return Ok(());
            }
            filtered
        } else {
            assets
        };

        // 2. Download assets
        self.emit_progress_event(
            state,
            profile_id,
            &format!(
                "Downloading assets for group: {} ({} files)...",
                asset_id,
                assets.objects.len()
            ),
            progress_start + progress_range * 0.1,
            None,
        )
        .await?;

        let cached_objects = match measure_time!(format!("NRC download '{}'", asset_id), self
            .download_nrc_assets(
                asset_id,
                &assets,
                Some(profile_id),
            )
            .await)
        {
            Ok(cached_objects) => cached_objects,
            Err(e) => {
                error!(
                    "[NRC Assets Group '{}'] Failed to download assets: {}. Skipping copy.",
                    asset_id, e
                );
                return Err(e);
            }
        };

        // 3. Copy overrides
        self.emit_progress_event(
            state,
            profile_id,
            &format!("Copying overrides for group: {}...", asset_id),
            progress_start + progress_range * 0.9,
            None,
        )
        .await?;

        if let Err(e) = measure_time!(format!("NRC copy '{}'", asset_id), self
            .copy_overrides_to_game_dir(
                asset_id,
                &assets,
                &cached_objects,
                game_directory,
                Some(profile_id),
            )
            .await)
        {
            error!(
                "[NRC Assets Group '{}'] Failed to copy overrides: {}",
                asset_id, e
            );
            return Err(e);
        }

        self.emit_progress_event(
            state,
            profile_id,
            &format!("Finished processing asset group: {}", asset_id),
            progress_end,
            None,
        )
        .await?;

        Ok(())
    }

    /// Downloads NoRisk client assets for a specific asset ID (pack or asset group).
    async fn download_nrc_assets(
        &self,
        asset_id: &str,
        assets: &NoriskAssets,
        profile_id: Option<Uuid>,
    ) -> Result<HashMap<String, u64>> {
        trace!(
            "[NRC Assets Download '{}'] Starting download process",
            asset_id
        );
        let assets_path = self.base_path.join(NORISK_ASSETS_DIR).join(asset_id);
        if !fs::try_exists(&assets_path).await? {
            fs::create_dir_all(&assets_path).await?;
            info!(
                "[NRC Assets Download '{}'] Created directory: {}",
                asset_id,
                assets_path.display()
            );
        }

        let mut downloads = Vec::new();

        trace!(
            "[NRC Assets Download '{}'] Preparing {} potential jobs...",
            asset_id,
            assets.objects.len()
        );

        let state = if profile_id.is_some() {
            State::get().await.ok()
        } else {
            None
        };

        // Pre-scan existing objects to avoid per-file fs::try_exists calls
        let objects_dir = assets_path.join("objects");
        let mut cached_objects = measure_time!(format!("NRC objects scan '{}'", asset_id), {
            scan_object_store(&objects_dir).await
        });

        for (name, asset) in &assets.objects {
            if cached_objects.contains_key(&asset.hash) {
                if let Some(stats) = &self.stats {
                    stats.record_cached();
                }
                continue;
            }

            let hash = &asset.hash;
            let target_path = objects_dir.join(&hash[..2]).join(hash);
            let stats = self.stats.clone();

            let task_id = downloads.len() + 1;
            downloads.push(async move {
                trace!("[NRC Assets Download '{}' Task {}] Starting download for: {}", asset_id, task_id, name);

                // ?v= = content hash, so Cloudflare can cache each version. No auth, the bucket is public.
                let url = format!(
                    "https://cdn.norisk.gg/assets/{}/assets/{}?v={}",
                    asset_id, name, hash
                );

                let response = match HTTP_CLIENT.get(&url).send().await {
                    Ok(resp) => resp,
                    Err(e) => {
                        error!("[NRC Assets Download '{}' Task {}] Request error for {}: {}", asset_id, task_id, name, e);
                        return Err(AppError::Download(format!("Request failed for {}: {}", name, e)));
                    }
                };

                if !response.status().is_success() {
                    let status = response.status();
                    let error_text = response.text().await.unwrap_or_else(|_| "No error details".to_string());
                    error!("[NRC Assets Download '{}' Task {}] Failed download for {}: Status {}, Error: {}",
                           asset_id, task_id, name, status, error_text);
                    return Err(AppError::Download(format!("Download failed for {} - Status {}: {}", name, status, error_text)));
                }

                let bytes = match response.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                         error!("[NRC Assets Download '{}' Task {}] Error reading bytes for {}: {}", asset_id, task_id, name, e);
                         return Err(AppError::Download(format!("Read bytes failed for {}: {}", name, e)));
                    }
                };

                if let Some(parent) = target_path.parent() {
                    if let Err(e) = fs::create_dir_all(parent).await {
                        error!("[NRC Assets Download '{}' Task {}] Error creating dir for {}: {}", asset_id, task_id, name, e);
                         return Err(AppError::Io(e));
                    }
                }

                let mut file = match fs::File::create(&target_path).await {
                    Ok(f) => f,
                    Err(e) => {
                        error!("[NRC Assets Download '{}' Task {}] Error creating file for {}: {}", asset_id, task_id, name, e);
                         return Err(AppError::Io(e));
                    }
                };

                if let Err(e) = file.write_all(&bytes).await {
                    error!("[NRC Assets Download '{}' Task {}] Error writing file for {}: {}", asset_id, task_id, name, e);
                     return Err(AppError::Io(e));
                }

                if let Some(stats) = &stats {
                    stats.record_downloaded(bytes.len() as u64);
                }

                Ok((task_id, name, hash, bytes.len() as u64))
            });
        }

        let job_count = downloads.len();
        info!(
            "[NRC Assets Download '{}'] Queued {} actual download tasks.",
            asset_id, job_count
        );

        if job_count == 0 {
            info!(
                "[NRC Assets Download '{}'] No new assets to download.",
                asset_id
            );
            if let (Some(state_ref), Some(profile_id_val)) = (&state, profile_id) {
                self.emit_progress_event(
                    state_ref,
                    profile_id_val,
                    &format!("Assets for group '{}' are up to date!", asset_id),
                    0.8,
                    None,
                )
                .await?;
            }
            return Ok(cached_objects);
        }

        info!(
            "[NRC Assets Download '{}'] Processing tasks with {} concurrent downloads...",
            asset_id, self.concurrent_downloads
        );

        let throttle = ProgressThrottle::new(100);
        let mut completed = 0;
        let mut errors = Vec::new();
        let mut pending = stream::iter(downloads).buffer_unordered(self.concurrent_downloads);
        while let Some(result) = pending.next().await {
            match result {
                Ok((task_id, name, hash, size)) => {
                    completed += 1;
                    trace!(
                        "[NRC Assets Download '{}' Task {}] Finished download for: {} ({}/{})",
                        asset_id, task_id, name, completed, job_count
                    );
                    cached_objects.insert(hash.clone(), size);
                }
                Err(error) => errors.push(error),
            }
            if let (Some(state), Some(profile_id)) = (&state, profile_id) {
                if throttle.should_emit() {
                    let message = format!(
                        "Downloading '{}' assets: {}/{} files", asset_id, completed, job_count
                    );
                    let progress = 0.1 + (completed as f64 / job_count as f64) * 0.7;
                    if let Err(e) = self
                        .emit_progress_event(state, profile_id, &message, progress, None)
                        .await
                    {
                        error!("[NRC Assets Download '{}'] Failed to emit progress event: {}", asset_id, e);
                    }
                }
            }
        }
        if let Some(stats) = &self.stats {
            for _ in &errors {
                stats.record_failed();
            }
        }

        if !errors.is_empty() {
            error!(
                "[NRC Assets Download '{}'] Finished with {} errors:",
                asset_id,
                errors.len()
            );
            for error_item in &errors {
                error!("  - {}", error_item);
            }

            if let (Some(state_ref), Some(profile_id_val)) = (&state, profile_id) {
                self.emit_progress_event(
                    state_ref,
                    profile_id_val,
                    &format!(
                        "Failed download for group '{}' ({} errors)",
                        asset_id,
                        errors.len()
                    ),
                    0.8,
                    Some(errors[0].to_string()),
                )
                .await?;
            }
            Err(errors.remove(0))
        } else {
            info!(
                "[NRC Assets Download '{}'] All asset downloads completed successfully.",
                asset_id
            );

            if let (Some(state_ref), Some(profile_id_val)) = (&state, profile_id) {
                self.emit_progress_event(
                    state_ref,
                    profile_id_val,
                    &format!("Asset download completed for group '{}'", asset_id),
                    0.8,
                    None,
                )
                .await?;
            }
            Ok(cached_objects)
        }
    }

    /// Helper method to emit progress events
    async fn emit_progress_event(
        &self,
        state: &State,
        profile_id: Uuid,
        message: &str,
        progress: f64,
        error: Option<String>,
    ) -> Result<Uuid> {
        let event_id = Uuid::new_v4();
        state
            .emit_event(EventPayload {
                event_id,
                event_type: EventType::DownloadingNoRiskClientAssets,
                target_id: Some(profile_id),
                message: message.to_string(),
                progress: Some(progress.clamp(0.0, 1.0)),
                error,
            })
            .await?;
        Ok(event_id)
    }

    async fn copy_overrides_to_game_dir(
        &self,
        asset_id: &str,
        assets: &NoriskAssets,
        cached_objects: &HashMap<String, u64>,
        minecraft_dir: &Path,
        profile_id: Option<Uuid>,
    ) -> Result<()> {
        let source_objects_dir = self
            .base_path
            .join(NORISK_ASSETS_DIR)
            .join(asset_id)
            .join("objects");

        let mut copied_count = 0;
        let mut skipped_count = 0;

        for (name, asset) in &assets.objects {
            let Some(relative_path) = name.strip_prefix("overrides/") else {
                continue;
            };
            let hash = &asset.hash;
            let target_path = minecraft_dir.join(relative_path);

            if !cached_objects.contains_key(hash.as_str()) {
                warn!(
                    "[NRC Assets Copy '{}'] Hash file missing in cache for override {} (hash {})",
                    asset_id, relative_path, hash
                );
                continue;
            }

            if fs::try_exists(&target_path).await? {
                skipped_count += 1;
                continue;
            }

            let source_path = source_objects_dir.join(&hash[0..2]).join(hash);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::copy(&source_path, &target_path).await?;
            copied_count += 1;
        }

        if let (Ok(state), Some(profile_id)) = (State::get().await, profile_id) {
            self.emit_copy_event(
                &state,
                profile_id,
                &format!(
                    "Override copy completed for group '{}'. Copied: {}, Skipped: {}",
                    asset_id, copied_count, skipped_count
                ),
                1.0,
                None,
            )
            .await?;
        }

        info!(
            "[NRC Assets Copy '{}'] Overrides done. Copied: {}, Skipped: {}",
            asset_id, copied_count, skipped_count
        );
        Ok(())
    }

    /// Helper method for emitting copy progress events
    async fn emit_copy_event(
        &self,
        state: &State,
        profile_id: Uuid,
        message: &str,
        progress: f64,
        error: Option<String>,
    ) -> Result<Uuid> {
        let event_id = Uuid::new_v4();
        state
            .emit_event(EventPayload {
                event_id,
                event_type: EventType::CopyingNoRiskClientAssets,
                target_id: Some(profile_id),
                message: message.to_string(),
                progress: Some(progress.clamp(0.0, 1.0)),
                error,
            })
            .await?;
        Ok(event_id)
    }
}
