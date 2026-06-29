use crate::error::{AppError, CommandError};
use crate::state::state_manager::State;
use uuid::Uuid;

pub struct AccountCtx {
    pub token: String,
    pub is_experimental: bool,
    pub account_uuid: Option<Uuid>,
}

pub async fn account_ctx(norisk_token: Option<String>) -> Result<AccountCtx, CommandError> {
    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let (token, account_uuid) = match norisk_token {
        Some(t) => (t, None),
        None => {
            let acc = state
                .minecraft_account_manager_v2
                .get_active_account()
                .await?
                .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;
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
