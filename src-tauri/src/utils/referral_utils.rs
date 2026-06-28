//! Referral tracking utilities for affiliate and friend referral links.
//!
//! Flow:
//! 1. NSIS installer writes referral code to referral_code.txt in install dir
//! 2. On startup, we read the code and save it to config.referral_state
//! 3. After login (when we have a NoRisk token), we report the code
//! 4. On successful report, we set redeemed=true (code stays for tracing!)

use log::{debug, error, info, warn};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::error::Result;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::config_state::ReferralState;
use crate::state::State;

/// Filename for the referral code written by the installer
const REFERRAL_CODE_FILENAME: &str = "referral_code.txt";

/// Check for referral code file and save to config.
/// This should be called during launcher startup.
/// Does NOT send to backend - that happens after login with token.
pub async fn check_and_process_referral_code() -> Result<()> {
    info!("[Referral] Checking for referral code...");

    // Get the install directory (where the executable is located)
    let install_dir = get_install_directory()?;
    let referral_file_path = install_dir.join(REFERRAL_CODE_FILENAME);

    debug!(
        "[Referral] Looking for referral code at: {:?}",
        referral_file_path
    );

    // Check if referral file exists
    if !referral_file_path.exists() {
        debug!("[Referral] No referral code file found");
        return Ok(());
    }

    // Read the referral code from file
    let referral_code = match tokio::fs::read_to_string(&referral_file_path).await {
        Ok(content) => content.trim().to_string(),
        Err(e) => {
            error!("[Referral] Failed to read referral code file: {}", e);
            return Ok(()); // Don't fail the startup
        }
    };

    // Validate the code is not empty
    if referral_code.is_empty() {
        warn!("[Referral] Referral code file was empty");
        // Delete the empty file
        let _ = tokio::fs::remove_file(&referral_file_path).await;
        return Ok(());
    }

    info!("[Referral] Found referral code: {}", referral_code);

    // Get state and save to config
    let state = State::get().await?;
    let mut config = state.config_manager.get_config().await;

    // Save referral code to config as ReferralState (redeemed = false)
    config.referral_state = Some(ReferralState {
        code: referral_code.clone(),
        redeemed: false,
        redeemed_at: None,
        redeemed_by_account: None,
    });
    state.config_manager.set_config(config).await?;
    info!("[Referral] Saved referral code to config as ReferralState (redeemed=false)");

    // Delete the referral code file (we've saved it to config)
    if let Err(e) = tokio::fs::remove_file(&referral_file_path).await {
        warn!("[Referral] Failed to delete referral code file: {}", e);
    } else {
        debug!("[Referral] Deleted referral code file");
    }

    Ok(())
}

/// Report pending referral code after login.
/// This function handles getting the NoRisk token and reporting the referral code.
/// Call this after successful login.
///
/// # Arguments
/// * `account_id` - The Minecraft account UUID of the logged-in user
pub async fn report_referral_after_login(account_id: Uuid) -> Result<()> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    // Check if we have a referral state that hasn't been redeemed yet
    match &config.referral_state {
        Some(state) if !state.redeemed => {
            debug!("[Referral] Found unredeemed referral code: {}", state.code);
        }
        Some(state) => {
            debug!("[Referral] Referral code already redeemed: {}", state.code);
            return Ok(());
        }
        None => {
            debug!("[Referral] No referral state to report");
            return Ok(());
        }
    }

    let is_experimental = config.is_experimental;

    // Get account with refreshed tokens
    info!("[Referral] Getting account with refreshed tokens for referral report...");
    let credentials = match state
        .minecraft_account_manager_v2
        .get_account_by_id_with_refresh(account_id, is_experimental)
        .await?
    {
        Some(creds) => creds,
        None => {
            warn!("[Referral] Account not found for referral report: {}", account_id);
            return Ok(());
        }
    };

    // Get the token from the refreshed credentials
    let token = if is_experimental {
        &credentials.norisk_credentials.experimental
    } else {
        &credentials.norisk_credentials.production
    };

    let norisk_token = match token {
        Some(t) => &t.value,
        None => {
            warn!("[Referral] Failed to get NoRisk token for referral report");
            return Ok(());
        }
    };

    // Now report with the token
    report_referral_with_token(norisk_token, account_id, is_experimental).await
}

/// Report pending referral code using NoRisk token (secure, after login).
/// Call this after successful login when we have a valid NoRisk token.
///
/// # Arguments
/// * `norisk_token` - The NoRisk JWT token for authentication
/// * `account_id` - The Minecraft account UUID
/// * `is_experimental` - Whether to use staging or production API
async fn report_referral_with_token(
    norisk_token: &str,
    account_id: Uuid,
    is_experimental: bool,
) -> Result<()> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    // Check if we have a referral state that hasn't been redeemed
    let referral_state = match &config.referral_state {
        Some(s) if !s.redeemed => s.clone(),
        Some(s) => {
            debug!("[Referral] Referral code already redeemed: {}", s.code);
            return Ok(());
        }
        None => {
            debug!("[Referral] No referral state to report");
            return Ok(());
        }
    };

    info!("[Referral] Reporting referral code: {} for account: {}", referral_state.code, account_id);

    match NoRiskApi::report_referral_code(norisk_token, &referral_state.code, account_id, is_experimental).await {
        Ok(_) => {
            info!("[Referral] Successfully reported referral code");

            // Get current timestamp
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            // Update state with redeemed info (code stays!)
            let mut updated_config = state.config_manager.get_config().await;
            updated_config.referral_state = Some(ReferralState {
                code: referral_state.code.clone(),
                redeemed: true,
                redeemed_at: Some(timestamp),
                redeemed_by_account: Some(account_id.to_string()),
            });
            state.config_manager.set_config(updated_config).await?;
            info!("[Referral] Marked referral code as redeemed (code preserved for tracing)");
        }
        Err(e) => {
            warn!("[Referral] Failed to report referral code: {}", e);
            // Keep the state as is, will try again next login
        }
    }

    Ok(())
}

/// Get the installation directory (where the executable is located)
fn get_install_directory() -> Result<PathBuf> {
    // Get the path to the current executable
    let exe_path = std::env::current_exe().map_err(|e| {
        crate::error::AppError::Other(format!("Failed to get executable path: {}", e))
    })?;

    // Get the parent directory
    let install_dir = exe_path.parent().ok_or_else(|| {
        crate::error::AppError::Other("Failed to get install directory".to_string())
    })?;

    Ok(install_dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_install_directory() {
        let result = get_install_directory();
        assert!(result.is_ok());
        let dir = result.unwrap();
        assert!(dir.exists());
    }
}
