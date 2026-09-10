use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::minecraft::auth::minecraft_auth::{
    mc_token_expiry, AuthFlow, Credentials, MinecraftAuthStore, NoRiskCredentials,
};
use log::{info, warn};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Discard handback files older than this — same tolerance the Discord channel uses.
const HANDBACK_TTL_MS: u64 = 30_000;

/// Freshly minted Minecraft access tokens live ~24h.
const MC_TOKEN_LIFETIME_SECS: u64 = 24 * 3600;

#[derive(Deserialize)]
struct HandbackEntry {
    account_id: String,
    #[serde(default)]
    username: String,
    access_token: String,
    refresh_token: String,
    expires: String,
    #[serde(default)]
    auth_flow: Option<AuthFlow>,
    timestamp: u64,
}

/// Apply any pending token handbacks the in-game client dropped under `<meta>/auth/`.
///
/// The client re-mints a Minecraft token in-game (which invalidates the one persisted on disk) and
/// hands the fresh credential here instead of writing `accounts.json` itself — the launcher is the
/// single writer of `accounts.json`. Mirrors `discord_state.rs::read_active_client_state`.
pub async fn consume_pending(store: &MinecraftAuthStore) {
    let dir = LAUNCHER_DIRECTORY.meta_dir().join("auth");
    let read_dir = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    for entry in read_dir.flatten() {
        let path = entry.path();
        let is_handback = path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with("handback.") && n.ends_with(".json"));
        if !is_handback {
            continue;
        }

        let parsed: Option<HandbackEntry> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok());
        let handback = match parsed {
            Some(h) => h,
            None => continue, // torn/partial write → keep file, retry next tick
        };

        if now.saturating_sub(handback.timestamp) > HANDBACK_TTL_MS {
            std::fs::remove_file(&path).ok();
            continue;
        }

        let account_id = match Uuid::parse_str(&handback.account_id) {
            Ok(id) => id,
            Err(_) => {
                std::fs::remove_file(&path).ok();
                continue;
            }
        };

        // Update an existing account's token fields, or create a brand-new account the user just
        // added in-game. Either way the launcher stays the single writer of accounts.json.
        let existing = store.get_account_by_id(account_id).await.ok().flatten();

        let (updated, is_new, username) = match existing {
            Some(acc) => {
                let username = acc.username.clone();
                let mut u = acc.clone();
                u.access_token = handback.access_token;
                u.refresh_token = handback.refresh_token;
                u.expires = handback.expires.parse().unwrap_or(acc.expires);
                u.auth_flow = handback.auth_flow.or(acc.auth_flow);
                u.mc_access_token_expires = Some(mc_token_expiry(MC_TOKEN_LIFETIME_SECS));
                (u, false, username)
            }
            None => {
                // New account added in-game — norisk token, child-protection and referral all
                // self-heal on first launch, so we seed only the Microsoft/Minecraft side here.
                let expires = match handback.expires.parse() {
                    Ok(e) => e,
                    Err(_) => {
                        std::fs::remove_file(&path).ok();
                        continue; // cannot create an account without a valid expiry
                    }
                };
                let username = handback.username.clone();
                let creds = Credentials {
                    id: account_id,
                    username: handback.username,
                    access_token: handback.access_token,
                    refresh_token: handback.refresh_token,
                    expires,
                    norisk_credentials: NoRiskCredentials {
                        production: None,
                        experimental: None,
                    },
                    active: false, // added inactive — don't hijack the launcher's active selection
                    ignore_child_protection_warning: false,
                    auth_flow: handback.auth_flow,
                    mc_access_token_expires: Some(mc_token_expiry(MC_TOKEN_LIFETIME_SECS)),
                    twitch_token: None,
                };
                (creds, true, username)
            }
        };

        match store.update_or_insert(updated).await {
            Ok(_) => {
                if is_new {
                    info!("[Auth Handback] Added new account {}", username);
                } else {
                    info!("[Auth Handback] Applied fresh token for {}", username);
                }
            }
            Err(e) => {
                warn!(
                    "[Auth Handback] Failed to persist handback for {}: {:?}",
                    username, e
                );
                continue; // keep file, retry next tick
            }
        }

        std::fs::remove_file(&path).ok();
    }
}
