use crate::error::{AppError, Result};
use crate::friends::models::{
    ChatMessage, FriendOnlineEvent, OnlineStateChangeEvent, UserTypingEvent,
};
use crate::minecraft::api::norisk_api::NoRiskApi;
use futures_util::{SinkExt, StreamExt};
use log::error;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WebSocketMessage {
    channel: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub enum WsCommand {
    Connect {
        uuid: Uuid,
        username: String,
        token: String,
    },
    Disconnect,
    SendTyping {
        chat_id: String,
    },
}

pub struct FriendsWebSocket {
    connected: Arc<RwLock<bool>>,
    command_tx: Option<mpsc::Sender<WsCommand>>,
}

impl FriendsWebSocket {
    pub fn new() -> Self {
        Self {
            connected: Arc::new(RwLock::new(false)),
            command_tx: None,
        }
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }

    pub async fn connect(
        &mut self,
        app_handle: Arc<tauri::AppHandle>,
        uuid: Uuid,
        username: String,
        token: String,
        is_experimental: bool,
    ) -> Result<()> {
        if self.is_connected().await {
            return Ok(());
        }

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<WsCommand>(32);
        self.command_tx = Some(cmd_tx);

        let connected = self.connected.clone();
        let app = app_handle.clone();

        tokio::spawn(async move {
            let mut reconnect_delay = Duration::from_secs(1);
            let max_reconnect_delay = Duration::from_secs(60);

            loop {
                let base_url = NoRiskApi::get_api_base(is_experimental);
                let ws_url = base_url
                    .replace("https://", "wss://")
                    .replace("http://", "ws://");
                let url = format!(
                    "{}/core/ws?uuid={}&ign={}&token={}",
                    ws_url, uuid, username, token
                );

                let ws_key = tokio_tungstenite::tungstenite::handshake::client::generate_key();
                let host = if is_experimental { "api-staging.norisk.gg" } else { "api.norisk.gg" };

                let request = tokio_tungstenite::tungstenite::http::Request::builder()
                    .uri(&url)
                    .header("Host", host)
                    .header("Authorization", format!("Bearer {}", token))
                    .header("Connection", "Upgrade")
                    .header("Upgrade", "websocket")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", ws_key)
                    .body(())
                    .unwrap();

                match connect_async(request).await {
                    Ok((ws_stream, _)) => {
                        *connected.write().await = true;
                        reconnect_delay = Duration::from_secs(1);

                        let _ = app.emit("friends:ws_connected", ());

                        let (mut write, mut read) = ws_stream.split();

                        loop {
                            tokio::select! {
                                msg = read.next() => {
                                    match msg {
                                        Some(Ok(Message::Text(text))) => {
                                            Self::handle_message(&app, &text).await;
                                        }
                                        Some(Ok(Message::Ping(data))) => {
                                            if write.send(Message::Pong(data)).await.is_err() {
                                                break;
                                            }
                                        }
                                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                                cmd = cmd_rx.recv() => {
                                    match cmd {
                                        Some(WsCommand::Disconnect) => {
                                            let _ = write.close().await;
                                            *connected.write().await = false;
                                            let _ = app.emit("friends:ws_disconnected", ());
                                            return;
                                        }
                                        Some(WsCommand::SendTyping { chat_id }) => {
                                            let msg = serde_json::json!({
                                                "channel": "messaging:user_typing",
                                                "payload": { "chatId": chat_id }
                                            });
                                            let _ = write.send(Message::Text(msg.to_string().into())).await;
                                        }
                                        None => {
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }

                        *connected.write().await = false;
                        let _ = app.emit("friends:ws_disconnected", ());
                    }
                    Err(e) => {
                        error!("[Friends WS] Connection failed: {}", e);
                    }
                }

                if reconnect_delay >= max_reconnect_delay {
                    *connected.write().await = false;
                    let _ = app.emit("friends:ws_disconnected", ());
                    return;
                }

                tokio::time::sleep(reconnect_delay).await;
                reconnect_delay = std::cmp::min(reconnect_delay * 2, max_reconnect_delay);
            }
        });

        Ok(())
    }

    async fn handle_message(app: &tauri::AppHandle, text: &str) {
        let parts: Vec<&str> = text.splitn(3, ' ').collect();
        if parts.len() < 3 {
            return;
        }

        let channel = parts[0];
        let payload: serde_json::Value = match serde_json::from_str(parts[2]) {
            Ok(p) => p,
            Err(_) => return,
        };

        match channel {
            "nrc_friends:friend_online" => {
                if let Ok(event) = serde_json::from_value::<FriendOnlineEvent>(payload.clone()) {
                    let _ = app.emit("friends:friend_online", event);
                } else {
                    let _ = app.emit("friends:friend_online", payload);
                }
            }
            "nrc_friends:friend_offline" => {
                if let Ok(event) = serde_json::from_value::<FriendOnlineEvent>(payload.clone()) {
                    let _ = app.emit("friends:friend_offline", event);
                } else {
                    let _ = app.emit("friends:friend_offline", payload);
                }
            }
            "nrc_friends:friend_changed_online_state" => {
                if let Ok(event) = serde_json::from_value::<OnlineStateChangeEvent>(payload.clone()) {
                    let _ = app.emit("friends:status_changed", event);
                } else {
                    let _ = app.emit("friends:status_changed", payload);
                }
            }
            "nrc_friends:friend_request" => {
                let _ = app.emit("friends:request_received", payload);
            }
            "nrc_friends:server_change" => {
                let _ = app.emit("friends:server_changed", payload);
            }
            "messaging:message_received" => {
                if let Ok(message) = serde_json::from_value::<ChatMessage>(payload.clone()) {
                    let _ = app.emit("chat:message_received", message);
                } else {
                    let _ = app.emit("chat:message_received", payload);
                }
            }
            "messaging:message_updated" => {
                let _ = app.emit("chat:message_updated", payload);
            }
            "messaging:message_deleted" => {
                let _ = app.emit("chat:message_deleted", payload);
            }
            "messaging:user_typing" => {
                if let Ok(event) = serde_json::from_value::<UserTypingEvent>(payload) {
                    let _ = app.emit("chat:user_typing", event);
                }
            }
            "messaging:chat_created" => {
                let _ = app.emit("chat:created", payload);
            }
            _ => {}
        }
    }

    pub async fn disconnect(&self) -> Result<()> {
        if let Some(tx) = &self.command_tx {
            tx.send(WsCommand::Disconnect)
                .await
                .map_err(|e| AppError::Other(format!("Failed to send disconnect: {}", e)))?;
        }
        Ok(())
    }

    pub async fn send_typing(&self, chat_id: String) -> Result<()> {
        if let Some(tx) = &self.command_tx {
            tx.send(WsCommand::SendTyping { chat_id })
                .await
                .map_err(|e| AppError::Other(format!("Failed to send typing: {}", e)))?;
        }
        Ok(())
    }
}

impl Default for FriendsWebSocket {
    fn default() -> Self {
        Self::new()
    }
}
