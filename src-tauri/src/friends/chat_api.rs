use crate::error::Result;
use crate::friends::models::{Chat, ChatMessage, ComputedChat, CreateChatMessageRequest};
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::utils::http_client::{nrc_delete, nrc_get, nrc_post, nrc_put};
use log::debug;
use uuid::Uuid;

pub struct ChatApi;

impl ChatApi {
    pub async fn get_or_create_private_chat(
        norisk_token: &str,
        friend_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<Chat> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/chat/private/{}", base_url, friend_uuid);

        debug!("[Chat API] Getting or creating chat with {}", friend_uuid);

        nrc_get(&url)
            .bearer(norisk_token)
            .json::<Chat>("Chat get/create private")
            .await
    }

    pub async fn get_private_chats(
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<Vec<ComputedChat>> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/chat/private", base_url);

        debug!("[Chat API] Fetching all private chats");

        nrc_get(&url)
            .bearer(norisk_token)
            .json::<Vec<ComputedChat>>("Chat get private list")
            .await
    }

    pub async fn get_messages(
        norisk_token: &str,
        chat_id: &str,
        page: u32,
        limit: u32,
        is_experimental: bool,
    ) -> Result<Vec<ChatMessage>> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/chat/{}/messages", base_url, chat_id);

        debug!("[Chat API] Fetching messages for chat {} page {} limit {}", chat_id, page, limit);

        nrc_get(&url)
            .bearer(norisk_token)
            .query(&[("page", page.to_string()), ("limit", limit.to_string())])
            .json::<Vec<ChatMessage>>("Chat get messages")
            .await
    }

    pub async fn send_message(
        norisk_token: &str,
        chat_id: &str,
        content: &str,
        relates_to: Option<String>,
        is_experimental: bool,
    ) -> Result<ChatMessage> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/chat/{}/messages", base_url, chat_id);

        debug!("[Chat API] Sending message to chat {}", chat_id);

        let request = CreateChatMessageRequest {
            content: content.to_string(),
            relates_to,
        };

        nrc_post(&url)
            .bearer(norisk_token)
            .json_body(&request)
            .json::<ChatMessage>("Chat send message")
            .await
    }

    pub async fn edit_message(
        norisk_token: &str,
        message_id: &str,
        content: &str,
        is_experimental: bool,
    ) -> Result<ChatMessage> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/message/{}", base_url, message_id);

        debug!("[Chat API] Editing message {}", message_id);

        let mut body = std::collections::HashMap::new();
        body.insert("content", content);

        nrc_put(&url)
            .bearer(norisk_token)
            .json_body(&body)
            .json::<ChatMessage>("Chat edit message")
            .await
    }

    pub async fn delete_message(
        norisk_token: &str,
        message_id: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/message/{}", base_url, message_id);

        debug!("[Chat API] Deleting message {}", message_id);

        nrc_delete(&url)
            .bearer(norisk_token)
            .expect_success("Chat delete message")
            .await
    }

    pub async fn mark_message_received(
        norisk_token: &str,
        chat_id: &str,
        message_id: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/chat/{}/messages/received", base_url, chat_id);

        debug!("[Chat API] Marking message {} as received", message_id);

        let mut body = std::collections::HashMap::new();
        body.insert("messageId", message_id);

        nrc_post(&url)
            .bearer(norisk_token)
            .json_body(&body)
            .expect_success("Chat mark received")
            .await
    }

    pub async fn add_reaction(
        norisk_token: &str,
        message_id: &str,
        emoji: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/message/{}/reaction", base_url, message_id);

        debug!("[Chat API] Adding reaction {} to message {}", emoji, message_id);

        let mut body = std::collections::HashMap::new();
        body.insert("emoji", emoji);

        nrc_post(&url)
            .bearer(norisk_token)
            .json_body(&body)
            .expect_success("Chat add reaction")
            .await
    }

    pub async fn remove_reaction(
        norisk_token: &str,
        message_id: &str,
        emoji: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/messaging/message/{}/reaction", base_url, message_id);

        debug!("[Chat API] Removing reaction {} from message {}", emoji, message_id);

        nrc_delete(&url)
            .bearer(norisk_token)
            .query(&[("emoji", emoji)])
            .expect_success("Chat remove reaction")
            .await
    }
}
