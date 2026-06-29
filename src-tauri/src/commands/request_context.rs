use crate::error::{AppError, CommandError};
use crate::state::state_manager::State;

pub struct AccountCtx {
    pub token: String,
    pub is_experimental: bool,
}

pub async fn account_ctx(norisk_token: Option<String>) -> Result<AccountCtx, CommandError> {
    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let token = match norisk_token {
        Some(t) => t,
        None => {
            let acc = state
                .minecraft_account_manager_v2
                .get_active_account()
                .await?
                .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;
            acc.norisk_credentials.get_token_for_mode(is_experimental)?
        }
    };

    Ok(AccountCtx {
        token,
        is_experimental,
    })
}
