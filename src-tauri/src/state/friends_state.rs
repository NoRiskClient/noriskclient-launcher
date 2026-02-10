use crate::error::Result;
use crate::friends::models::{
    Chat, ChatMessage, ComputedChat, FriendRequestWithUsers, FriendsFriendUser, FriendsUser,
    OnlineState,
};
use crate::friends::websocket::FriendsWebSocket;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct FriendsState {
    current_user: RwLock<Option<FriendsUser>>,
    friends: DashMap<Uuid, FriendsFriendUser>,
    pending_requests: RwLock<Vec<FriendRequestWithUsers>>,
    chats: DashMap<String, ComputedChat>,
    messages: DashMap<String, Vec<ChatMessage>>,
    websocket: RwLock<FriendsWebSocket>,
}

impl FriendsState {
    pub fn new() -> Self {
        Self {
            current_user: RwLock::new(None),
            friends: DashMap::new(),
            pending_requests: RwLock::new(Vec::new()),
            chats: DashMap::new(),
            messages: DashMap::new(),
            websocket: RwLock::new(FriendsWebSocket::new()),
        }
    }

    pub async fn set_current_user(&self, user: FriendsUser) {
        *self.current_user.write().await = Some(user);
    }

    pub async fn get_current_user(&self) -> Option<FriendsUser> {
        self.current_user.read().await.clone()
    }

    pub async fn set_friends(&self, friends: Vec<FriendsFriendUser>) {
        self.friends.clear();
        for friend in friends {
            self.friends.insert(friend.uuid, friend);
        }
    }

    pub async fn get_friends(&self) -> Vec<FriendsFriendUser> {
        self.friends.iter().map(|r| r.value().clone()).collect()
    }

    pub async fn get_friend(&self, uuid: &Uuid) -> Option<FriendsFriendUser> {
        self.friends.get(uuid).map(|r| r.value().clone())
    }

    pub async fn update_friend(&self, friend: FriendsFriendUser) {
        self.friends.insert(friend.uuid, friend);
    }

    pub async fn remove_friend(&self, uuid: &Uuid) {
        self.friends.remove(uuid);
    }

    pub async fn update_friend_status(&self, uuid: &Uuid, state: OnlineState) {
        if let Some(mut friend) = self.friends.get_mut(uuid) {
            friend.state = state;
        }
    }

    pub async fn update_friend_server(&self, uuid: &Uuid, server: Option<String>) {
        if let Some(mut friend) = self.friends.get_mut(uuid) {
            friend.server = server;
        }
    }

    pub async fn set_pending_requests(&self, requests: Vec<FriendRequestWithUsers>) {
        *self.pending_requests.write().await = requests;
    }

    pub async fn get_pending_requests(&self) -> Vec<FriendRequestWithUsers> {
        self.pending_requests.read().await.clone()
    }

    pub async fn add_pending_request(&self, request: FriendRequestWithUsers) {
        self.pending_requests.write().await.push(request);
    }

    pub async fn remove_pending_request(&self, request_id: &str) {
        self.pending_requests
            .write()
            .await
            .retain(|r| r.id != request_id);
    }

    pub async fn set_chat(&self, chat: ComputedChat) {
        self.chats.insert(chat.id.clone(), chat);
    }

    pub async fn get_chat(&self, chat_id: &str) -> Option<ComputedChat> {
        self.chats.get(chat_id).map(|r| r.value().clone())
    }

    pub async fn get_chats(&self) -> Vec<ComputedChat> {
        self.chats.iter().map(|r| r.value().clone()).collect()
    }

    pub async fn set_messages(&self, chat_id: &str, messages: Vec<ChatMessage>) {
        self.messages.insert(chat_id.to_string(), messages);
    }

    pub async fn add_message(&self, chat_id: &str, message: ChatMessage) {
        self.messages
            .entry(chat_id.to_string())
            .or_insert_with(Vec::new)
            .push(message);
    }

    pub async fn get_messages(&self, chat_id: &str) -> Vec<ChatMessage> {
        self.messages
            .get(chat_id)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    pub async fn update_message(&self, chat_id: &str, message: ChatMessage) {
        if let Some(mut messages) = self.messages.get_mut(chat_id) {
            if let Some(idx) = messages.iter().position(|m| m.id == message.id) {
                messages[idx] = message;
            }
        }
    }

    pub async fn delete_message(&self, chat_id: &str, message_id: &str) {
        if let Some(mut messages) = self.messages.get_mut(chat_id) {
            messages.retain(|m| m.id != message_id);
        }
    }

    pub async fn increment_unread(&self, chat_id: &str) {
        if let Some(mut chat) = self.chats.get_mut(chat_id) {
            chat.unread_messages += 1;
        }
    }

    pub async fn clear_unread(&self, chat_id: &str) {
        if let Some(mut chat) = self.chats.get_mut(chat_id) {
            chat.unread_messages = 0;
        }
    }

    pub async fn connect_websocket(
        &self,
        app_handle: Arc<tauri::AppHandle>,
        uuid: Uuid,
        username: String,
        token: String,
        is_experimental: bool,
    ) -> Result<()> {
        self.websocket
            .write()
            .await
            .connect(app_handle, uuid, username, token, is_experimental)
            .await
    }

    pub async fn disconnect_websocket(&self) -> Result<()> {
        self.websocket.read().await.disconnect().await
    }

    pub async fn is_websocket_connected(&self) -> bool {
        self.websocket.read().await.is_connected().await
    }

    pub async fn send_typing(&self, chat_id: String) -> Result<()> {
        self.websocket.read().await.send_typing(chat_id).await
    }

    pub async fn clear(&self) {
        *self.current_user.write().await = None;
        self.friends.clear();
        self.pending_requests.write().await.clear();
        self.chats.clear();
        self.messages.clear();
    }
}

impl Default for FriendsState {
    fn default() -> Self {
        Self::new()
    }
}
