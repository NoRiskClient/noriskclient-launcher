use crate::error::Result;
use crate::friends::websocket::FriendsWebSocket;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct FriendsState {
    websocket: RwLock<FriendsWebSocket>,
}

impl FriendsState {
    pub fn new() -> Self {
        Self {
            websocket: RwLock::new(FriendsWebSocket::new()),
        }
    }

    #[allow(dead_code, reason = "the WebSocket stays off until it is stable")]
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
}

impl Default for FriendsState {
    fn default() -> Self {
        Self::new()
    }
}
