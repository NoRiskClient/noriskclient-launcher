use crate::integrations::unified_mod::{search_mods_unified, get_mod_versions_unified, ModPlatform, UnifiedProjectType, UnifiedSortType, UnifiedModSearchParams, UnifiedModVersionsParams, UnifiedVersionResponse};
use crate::state::state_manager::State;
use crate::utils::mc_utils;
use log::{error, info, debug};

/// Debug function to list all worlds for all user profiles.
/// This should only be called temporarily during development.
pub async fn debug_print_all_profile_worlds() {
    debug!("--- [DEBUG] Starting World Check --- KAPPA");
    match State::get().await {
        Ok(state) => {
            match state.profile_manager.list_profiles().await {
                Ok(profiles) => {
                    if profiles.is_empty() {
                        debug!("--- [DEBUG] No profiles found.");
                    } else {
                        info!(
                            "--- [DEBUG] Checking worlds for {} profile(s)...",
                            profiles.len()
                        );
                        for profile in profiles {
                            // Überspringe Standard-Profile für diese Dateisystem-Prüfung
                            if profile.is_standard_version {
                                info!(
                                    "--- [DEBUG] Skipping standard profile: {} ({})",
                                    profile.name, profile.id
                                );
                                continue;
                            }

                            info!(
                                "--- [DEBUG] Checking Profile: {} ({}) ---",
                                profile.name, profile.id
                            );
                            match mc_utils::get_profile_worlds(profile.id).await {
                                Ok(worlds) => {
                                    if worlds.is_empty() {
                                        debug!("    No valid worlds found in saves directory.");
                                    } else {
                                        debug!("    Found Worlds:");
                                        for world in worlds {
                                            // Konvertiere Timestamp zu lesbarem Datum (optional, benötigt chrono crate)
                                            let last_played_str = world
                                                .last_played
                                                .map(|ts| {
                                                    chrono::DateTime::from_timestamp_millis(ts)
                                                        .map(|dt| {
                                                            dt.format("%Y-%m-%d %H:%M:%S")
                                                                .to_string()
                                                        })
                                                        .unwrap_or_else(|| {
                                                            "Invalid Timestamp".to_string()
                                                        })
                                                })
                                                .unwrap_or_else(|| "N/A".to_string());

                                            debug!("      - Folder: {}", world.folder_name);
                                            info!(
                                                "        Display Name: {}",
                                                world.display_name.as_deref().unwrap_or("N/A")
                                            );
                                            info!(
                                                "        Last Played: {} ({:?})",
                                                last_played_str, world.last_played
                                            );
                                            debug!("        Icon Path: {:?}", world.icon_path);
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!(
                                        "    Error getting worlds for profile {}: {}",
                                        profile.id, e
                                    );
                                }
                            }
                        }
                        debug!("--- [DEBUG] Finished World Check --- KAPPA");
                    }
                }
                Err(e) => {
                    error!("--- [DEBUG] Error listing profiles: {}", e);
                }
            }
        }
        Err(e) => {
            error!("--- [DEBUG] Error getting state for world check: {}", e);
        }
    }
}

/// Debug function to list all servers for all user profiles.
/// This should only be called temporarily during development.
pub async fn debug_print_all_profile_servers() {
    debug!("--- [DEBUG] Starting Server Check ---");
    match State::get().await {
        Ok(state) => {
            match state.profile_manager.list_profiles().await {
                Ok(profiles) => {
                    if profiles.is_empty() {
                        debug!("--- [DEBUG] No profiles found.");
                    } else {
                        info!(
                            "--- [DEBUG] Checking servers for {} profile(s)...",
                            profiles.len()
                        );
                        for profile in profiles {
                            // Skip standard profiles for this filesystem check
                            if profile.is_standard_version {
                                info!(
                                    "--- [DEBUG] Skipping standard profile: {} ({})",
                                    profile.name, profile.id
                                );
                                continue;
                            }

                            info!(
                                "--- [DEBUG] Checking Profile: {} ({}) ---",
                                profile.name, profile.id
                            );
                            match mc_utils::get_profile_servers(profile.id).await {
                                Ok(servers) => {
                                    if servers.is_empty() {
                                        info!(
                                            "    No servers found (servers.dat missing or empty)."
                                        );
                                    } else {
                                        debug!("    Found Servers:");
                                        for server in servers {
                                            info!(
                                                "      - Name: {}",
                                                server.name.as_deref().unwrap_or("N/A")
                                            );
                                            info!(
                                                "        Address: {}",
                                                server.address.as_deref().unwrap_or("N/A")
                                            );
                                            info!(
                                                "        Icon Present: {}",
                                                server.icon_base64.is_some()
                                            );
                                            info!(
                                                "        Accepts Textures: {:?}",
                                                server.accepts_textures
                                            ); // 0=prompt, 1=enabled, 2=disabled
                                            info!(
                                                "        Previews Chat: {:?}",
                                                server.previews_chat
                                            ); // bool?
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!(
                                        "    Error getting servers for profile {}: {}",
                                        profile.id, e
                                    );
                                }
                            }
                        }
                        debug!("--- [DEBUG] Finished Server Check ---");
                    }
                }
                Err(e) => {
                    error!("--- [DEBUG] Error listing profiles: {}", e);
                }
            }
        }
        Err(e) => {
            error!("--- [DEBUG] Error getting state for server check: {}", e);
        }
    }
}

/// Debug function to fetch and print news/changelog posts.
/// This should only be called temporarily during development.
pub async fn debug_print_news_and_changelogs() {
    use crate::minecraft::api::wordpress_api::WordPressApi;
    debug!("--- [DEBUG] Starting News/Changelog Check ---");

    match WordPressApi::get_news_and_changelogs().await {
        Ok(posts) => {
            if posts.is_empty() {
                debug!("--- [DEBUG] No news or changelog posts found.");
            } else {
                info!(
                    "--- [DEBUG] Fetched {} news/changelog post(s):",
                    posts.len()
                );
                for post in posts {
                    let date = &post.date;
                    let og_image_url = post
                        .yoast_head_json
                        .as_ref()
                        .and_then(|seo| seo.og_image.as_ref())
                        .and_then(|images| images.first())
                        .and_then(|img| img.url.as_ref())
                        .map(|s| s.as_str())
                        .unwrap_or("N/A");

                    //debug!("    - Title: {}", title);
                    debug!("      Date: {}", date);
                    debug!("      OG Image: {}", og_image_url);
                    // Optionally print more details like excerpt or link
                    // debug!("      Excerpt: {}", post.excerpt.rendered);
                    // debug!("      Link: {}", post.link);
                }
                debug!("--- [DEBUG] Finished News/Changelog Check ---");
            }
        }
        Err(e) => {
            error!("--- [DEBUG] Error fetching news/changelogs: {} ---", e);
        }
    }
}

/// Debug function to test unified mod search for both Modrinth and CurseForge.
/// This should only be called temporarily during development.
pub async fn debug_unified_mod_search() {
    debug!("--- [DEBUG] Starting Unified Mod Search Test ---");

    // Base parameters for testing
    let base_params = UnifiedModSearchParams {
        query: "".to_string(),
        source: ModPlatform::Modrinth, // Default, will be overridden
        project_type: UnifiedProjectType::Mod,
        game_version: None,
        categories: None,
        mod_loaders: None,
        limit: Some(5),
        offset: Some(0),
        sort: Some(UnifiedSortType::Relevance),
        client_side_filter: None,
        server_side_filter: None,
    };

    // Test Modrinth search
    debug!("--- [DEBUG] Testing Modrinth search ---");
    let mut modrinth_params = base_params.clone();
    modrinth_params.source = ModPlatform::Modrinth;

    match search_mods_unified(modrinth_params).await {
        Ok(response) => {
            debug!("Modrinth search successful: {} results", response.results.len());
            for result in &response.results {
                debug!("  - {} ({:?}) - {} downloads", result.title, result.source, result.downloads);
            }
        }
        Err(e) => {
            error!("Modrinth search failed: {}", e);
        }
    }

    // Test CurseForge search
    debug!("--- [DEBUG] Testing CurseForge search ---");
    let mut curseforge_params = base_params.clone();
    curseforge_params.source = ModPlatform::CurseForge;

    match search_mods_unified(curseforge_params).await {
        Ok(response) => {
            debug!("CurseForge search successful: {} results", response.results.len());
            for result in &response.results {
                debug!("  - {} ({:?}) - {} downloads", result.title, result.source, result.downloads);
            }
        }
        Err(e) => {
            error!("CurseForge search failed: {}", e);
        }
    }

    debug!("--- [DEBUG] Finished Unified Mod Search Test ---");
}

/// Debug function to test unified mod versions retrieval.
/// Fetches the first mod from each platform and prints its available versions.
/// This should only be called temporarily during development.
pub async fn debug_unified_mod_versions() {
    debug!("--- [DEBUG] Starting Unified Mod Versions Test ---");

    // Base parameters for testing
    let base_params = UnifiedModSearchParams {
        query: "".to_string(),
        source: ModPlatform::Modrinth, // Default, will be overridden
        project_type: UnifiedProjectType::Mod,
        game_version: None,
        categories: None,
        mod_loaders: None,
        limit: Some(1), // Only get the first result
        offset: Some(0),
        sort: Some(UnifiedSortType::Relevance),
        client_side_filter: None,
        server_side_filter: None,
    };

    // Test Modrinth versions
    debug!("--- [DEBUG] Testing Modrinth versions ---");
    let mut modrinth_params = base_params.clone();
    modrinth_params.source = ModPlatform::Modrinth;

    match search_mods_unified(modrinth_params).await {
        Ok(search_response) => {
            if let Some(first_mod) = search_response.results.first() {
                debug!("Found Modrinth mod: {} (ID: {})", first_mod.title, first_mod.project_id);

                let modrinth_version_params = UnifiedModVersionsParams {
                    source: ModPlatform::Modrinth,
                    project_id: first_mod.project_id.clone(),
                    loaders: None,
                    game_versions: None,
                    limit: Some(5), // limit to first 5 versions
                    offset: None,
                };

                match get_mod_versions_unified(modrinth_version_params).await {
                    Ok(version_response) => {
                        debug!("Found {} versions for {}", version_response.versions.len(), first_mod.title);
                        for version in &version_response.versions {
                            debug!("  - Version: {} ({} downloads, {})",
                                version.version_number,
                                version.downloads,
                                version.date_published
                            );
                            if let Some(changelog) = &version.changelog {
                                let preview: String = changelog.chars().take(50).collect();
                                debug!("    Changelog preview: {}...", preview);
                            }
                            debug!("    Files: {}", version.files.len());
                            for file in &version.files {
                                debug!("      - {} ({} bytes)", file.filename, file.size);
                                if !file.hashes.is_empty() {
                                    debug!("        Hashes: {:?}", file.hashes.keys().collect::<Vec<_>>());
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to get versions for Modrinth mod {}: {}", first_mod.project_id, e);
                    }
                }
            } else {
                debug!("No Modrinth mods found");
            }
        }
        Err(e) => {
            error!("Modrinth search failed: {}", e);
        }
    }

    // Test CurseForge versions
    debug!("--- [DEBUG] Testing CurseForge versions ---");
    let mut curseforge_params = base_params.clone();
    curseforge_params.source = ModPlatform::CurseForge;

    match search_mods_unified(curseforge_params).await {
        Ok(search_response) => {
            if let Some(first_mod) = search_response.results.first() {
                debug!("Found CurseForge mod: {} (ID: {})", first_mod.title, first_mod.project_id);

                let curseforge_version_params = UnifiedModVersionsParams {
                    source: ModPlatform::CurseForge,
                    project_id: first_mod.project_id.clone(),
                    loaders: None,
                    game_versions: None,
                    limit: Some(5), // limit to first 5 versions
                    offset: None,
                };

                match get_mod_versions_unified(curseforge_version_params).await {
                    Ok(version_response) => {
                        debug!("Found {} versions for {}", version_response.versions.len(), first_mod.title);
                        for version in &version_response.versions {
                            debug!("  - Version: {} ({} downloads, {})",
                                version.version_number,
                                version.downloads,
                                version.date_published
                            );
                            debug!("    Files: {}", version.files.len());
                            for file in &version.files {
                                debug!("      - {} ({} bytes)", file.filename, file.size);
                                if !file.hashes.is_empty() {
                                    debug!("        Hashes: {:?}", file.hashes.keys().collect::<Vec<_>>());
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to get versions for CurseForge mod {}: {}", first_mod.project_id, e);
                    }
                }
            } else {
                debug!("No CurseForge mods found");
            }
        }
        Err(e) => {
            error!("CurseForge search failed: {}", e);
        }
    }

    debug!("--- [DEBUG] Finished Unified Mod Versions Test ---");
}
