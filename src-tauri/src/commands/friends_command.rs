use crate::error::{AppError, CommandError};
use crate::friends::api::FriendsApi;
use crate::friends::chat_api::ChatApi;
use crate::friends::models::{
    Chat, ChatMessage, ComputedChat, FriendRequestWithUsers, FriendsFriendUser, FriendsUser,
    OnlineState,
};
use crate::state::State;
use std::sync::Arc;
use tauri::Manager;
use uuid::Uuid;

async fn get_auth_info() -> Result<(String, Uuid, String, bool), CommandError> {
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "AccountError".to_string(),
        })?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let is_experimental = state.config_manager.get_config().await.is_experimental;

    let norisk_token = if is_experimental {
        account.norisk_credentials.experimental.as_ref()
    } else {
        account.norisk_credentials.production.as_ref()
    }
    .ok_or_else(|| CommandError {
        message: "No NoRisk token available".to_string(),
        kind: "NoToken".to_string(),
    })?;

    Ok((
        norisk_token.value.clone(),
        account.id,
        account.username.clone(),
        is_experimental,
    ))
}

#[tauri::command]
pub async fn get_friends() -> Result<Vec<FriendsFriendUser>, CommandError> {
    let (token, uuid, _, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let info = FriendsApi::get_friends(&token, &uuid, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    state.friends_state.set_friends(info.friends.clone()).await;

    Ok(info.friends)
}

#[tauri::command]
pub async fn get_pending_requests() -> Result<Vec<FriendRequestWithUsers>, CommandError> {
    let (token, uuid, _, is_experimental) = get_auth_info().await?;

    let info = FriendsApi::get_friends(&token, &uuid, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(info.pending)
}

#[tauri::command]
pub async fn get_friends_user() -> Result<FriendsUser, CommandError> {
    let (token, _, username, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let user = FriendsApi::get_current_user(&token, &username, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    state.friends_state.set_current_user(user.clone()).await;

    Ok(user)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn send_friend_request(target_name: String) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    FriendsApi::send_friend_request(&token, &target_name, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn accept_friend_request(target_name: String) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    FriendsApi::accept_friend_request(&token, &target_name, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn deny_friend_request(target_name: String) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    FriendsApi::deny_friend_request(&token, &target_name, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_friend(target_name: String, target_uuid: String) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    FriendsApi::remove_friend(&token, &target_name, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    let uuid = Uuid::parse_str(&target_uuid).map_err(|e| CommandError {
        message: format!("Invalid UUID: {}", e),
        kind: "ParseError".to_string(),
    })?;

    state.friends_state.remove_friend(&uuid).await;

    Ok(())
}

#[tauri::command]
pub async fn set_online_status(status: OnlineState) -> Result<OnlineState, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    let new_status = FriendsApi::update_status(&token, status, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(new_status)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn toggle_friend_ping(friend_name: String) -> Result<bool, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    let enabled = FriendsApi::toggle_ping(&token, &friend_name, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(enabled)
}

#[tauri::command]
pub async fn update_privacy_setting(
    setting: String,
    value: bool,
) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    FriendsApi::update_privacy_setting(&token, &setting, value, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command]
pub async fn connect_friends_websocket(
    _app: tauri::AppHandle,
) -> Result<(), CommandError> {
    // TODO: Re-enable when WebSocket is stable
    // let (token, uuid, username, is_experimental) = get_auth_info().await?;
    // let state = State::get().await.map_err(|e| CommandError {
    //     message: e.to_string(),
    //     kind: "StateError".to_string(),
    // })?;
    //
    // state
    //     .friends_state
    //     .connect_websocket(Arc::new(app), uuid, username, token, is_experimental)
    //     .await
    //     .map_err(|e| CommandError {
    //         message: e.to_string(),
    //         kind: "WebSocketError".to_string(),
    //     })?;

    Ok(())
}

#[tauri::command]
pub async fn disconnect_friends_websocket() -> Result<(), CommandError> {
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    state
        .friends_state
        .disconnect_websocket()
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "WebSocketError".to_string(),
        })?;

    Ok(())
}

#[tauri::command]
pub async fn is_friends_websocket_connected() -> Result<bool, CommandError> {
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    Ok(state.friends_state.is_websocket_connected().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_or_create_chat(friend_uuid: String) -> Result<Chat, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    let uuid = Uuid::parse_str(&friend_uuid).map_err(|e| CommandError {
        message: format!("Invalid UUID: {}", e),
        kind: "ParseError".to_string(),
    })?;

    let chat = ChatApi::get_or_create_private_chat(&token, &uuid, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(chat)
}

#[tauri::command]
pub async fn get_private_chats() -> Result<Vec<ComputedChat>, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let chats = ChatApi::get_private_chats(&token, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    for chat in &chats {
        state.friends_state.set_chat(chat.clone()).await;
    }

    Ok(chats)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_chat_messages(chat_id: String, page: u32, limit: Option<u32>) -> Result<Vec<ChatMessage>, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let limit = limit.unwrap_or(25);

    let messages = ChatApi::get_messages(&token, &chat_id, page, limit, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    if page <= 1 {
        state.friends_state.set_messages(&chat_id, messages.clone()).await;
    }

    Ok(messages)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn send_chat_message(
    chat_id: String,
    content: String,
    relates_to: Option<String>,
) -> Result<ChatMessage, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    let message = ChatApi::send_message(&token, &chat_id, &content, relates_to, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    state.friends_state.add_message(&chat_id, message.clone()).await;

    Ok(message)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn edit_chat_message(
    message_id: String,
    content: String,
) -> Result<ChatMessage, CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    let message = ChatApi::edit_message(&token, &message_id, &content, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(message)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_chat_message(message_id: String) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    ChatApi::delete_message(&token, &message_id, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn send_typing_indicator(chat_id: String) -> Result<(), CommandError> {
    let state = State::get().await.map_err(|e| CommandError {
        message: e.to_string(),
        kind: "StateError".to_string(),
    })?;

    state
        .friends_state
        .send_typing(chat_id)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "WebSocketError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_message_reaction(
    message_id: String,
    emoji: String,
) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    ChatApi::add_reaction(&token, &message_id, &emoji, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn remove_message_reaction(
    message_id: String,
    emoji: String,
) -> Result<(), CommandError> {
    let (token, _, _, is_experimental) = get_auth_info().await?;

    ChatApi::remove_reaction(&token, &message_id, &emoji, is_experimental)
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            kind: "ApiError".to_string(),
        })?;

    Ok(())
}
