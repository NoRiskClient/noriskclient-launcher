use crate::error::{AppError, CommandError};
use crate::state::state_manager::State;
use uuid::Uuid;

pub struct AccountCtx {
    pub token: String,
    pub is_experimental: bool,
    pub account_uuid: Option<Uuid>,
}

pub async fn account_ctx(norisk_token: Option<String>) -> Result<AccountCtx, CommandError> {
    account_ctx_mode(norisk_token, None, false).await
}

pub async fn account_ctx_mode(
    norisk_token: Option<String>,
    experimental_override: Option<bool>,
    refresh: bool,
) -> Result<AccountCtx, CommandError> {
    let state = State::get().await?;
    let is_experimental = match experimental_override {
        Some(v) => v,
        None => state.config_manager.is_experimental_mode().await,
    };

    let (token, account_uuid) = match norisk_token {
        Some(t) => (t, None),
        None => {
            let mgr = &state.minecraft_account_manager_v2;
            let acc = mgr
                .get_active_account()
                .await?
                .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;
            let acc = if refresh {
                match mgr.get_account_by_id_with_refresh(acc.id, is_experimental).await {
                    Ok(Some(fresh)) => fresh,
                    _ => acc,
                }
            } else {
                acc
            };
            let token = acc.norisk_credentials.get_token_for_mode(is_experimental)?;
            (token, Some(acc.id))
        }
    };

    Ok(AccountCtx {
        token,
        is_experimental,
        account_uuid,
    })
}
