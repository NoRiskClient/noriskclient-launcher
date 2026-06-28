use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OnlineState {
    Online,
    Offline,
    Afk,
    Busy,
    Invisible,
}

impl OnlineState {
    pub fn is_online(&self) -> bool {
        matches!(self, Self::Online | Self::Afk | Self::Busy)
    }

    pub fn is_active(&self) -> bool {
        !matches!(self, Self::Offline | Self::Afk)
    }
}

impl Default for OnlineState {
    fn default() -> Self {
        Self::Offline
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FriendRequestState {
    Pending,
    Accepted,
    Denied,
    Withdrawn,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsPrivacySettings {
    #[serde(default = "default_true")]
    pub show_server: bool,
    #[serde(default = "default_true")]
    pub allow_requests: bool,
    #[serde(default = "default_true")]
    pub allow_server_invites: bool,
}

fn default_true() -> bool {
    true
}

impl Default for FriendsPrivacySettings {
    fn default() -> Self {
        Self {
            show_server: true,
            allow_requests: true,
            allow_server_invites: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoRiskUserMinimal {
    pub uuid: Uuid,
    pub ign: String,
    #[serde(default, rename = "lastSeen")]
    pub last_seen: Option<String>,
    #[serde(default, rename = "discordId")]
    pub discord_id: Option<String>,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default, rename = "noRiskPlusExpirationDate")]
    pub no_risk_plus_expiration_date: Option<i64>,
    #[serde(default, rename = "nameTag")]
    pub name_tag: Option<serde_json::Value>,
    #[serde(default, rename = "loginStreak")]
    pub login_streak: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherNoRiskUser {
    pub uuid: Uuid,
    #[serde(default = "default_true")]
    pub has_ping_notification: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendsFriendUser {
    pub norisk_user: NoRiskUserMinimal,
    pub other_user: OtherNoRiskUser,
    pub online_state: OnlineState,
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendsUser {
    #[serde(rename = "_id")]
    pub user_id: Uuid,
    #[serde(default)]
    pub state: OnlineState,
    #[serde(default)]
    pub last_active_state: OnlineState,
    pub server: Option<String>,
    #[serde(default)]
    pub privacy: FriendsPrivacySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendsFriendRequest {
    pub sender: Uuid,
    pub receiver: Uuid,
    pub current_state: FriendRequestState,
    pub previous_state: Option<FriendRequestState>,
    #[serde(default)]
    pub timestamp: i64,
    #[serde(rename = "_id")]
    pub mongo_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendsFriendRequestResponse {
    pub friend_request: ApiFriendsFriendRequest,
    pub users: Vec<NoRiskUserMinimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFriendsInformationDto {
    pub friends: Vec<ApiFriendsFriendUser>,
    #[serde(default)]
    pub pending: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsUser {
    pub uuid: Uuid,
    pub username: String,
    pub state: OnlineState,
    pub server: Option<String>,
    pub privacy: FriendsPrivacySettings,
}

impl FriendsUser {
    pub fn from_api(api: ApiFriendsUser, username: String) -> Self {
        Self {
            uuid: api.user_id,
            username,
            state: api.state,
            server: api.server,
            privacy: api.privacy,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsFriendUser {
    pub uuid: Uuid,
    pub username: String,
    pub state: OnlineState,
    pub server: Option<String>,
    pub ping_enabled: bool,
}

impl From<ApiFriendsFriendUser> for FriendsFriendUser {
    fn from(api: ApiFriendsFriendUser) -> Self {
        Self {
            uuid: api.norisk_user.uuid,
            username: api.norisk_user.ign,
            state: api.online_state,
            server: api.server,
            ping_enabled: api.other_user.has_ping_notification,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestUser {
    pub uuid: Uuid,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestWithUsers {
    pub id: String,
    pub sender: Uuid,
    pub receiver: Uuid,
    pub state: FriendRequestState,
    pub timestamp: i64,
    pub users: Vec<FriendRequestUser>,
}

impl From<ApiFriendsFriendRequestResponse> for FriendRequestWithUsers {
    fn from(api: ApiFriendsFriendRequestResponse) -> Self {
        Self {
            id: api.friend_request.mongo_id,
            sender: api.friend_request.sender,
            receiver: api.friend_request.receiver,
            state: api.friend_request.current_state,
            timestamp: api.friend_request.timestamp,
            users: api
                .users
                .into_iter()
                .map(|u| FriendRequestUser {
                    uuid: u.uuid,
                    username: u.ign,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MessageStatus {
    Sent,
    Received,
    Read,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParticipant {
    pub user_id: Uuid,
    pub joined_at: i64,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    #[serde(rename = "_id")]
    pub id: String,
    pub participants: Vec<ChatParticipant>,
    #[serde(rename = "type", default)]
    pub chat_type: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub timestamp: Option<i64>,
    #[serde(default)]
    pub group_avatar_url: Option<String>,
    #[serde(default)]
    pub unread_messages: Option<u32>,
    #[serde(default)]
    pub latest_message: Option<Box<ChatMessage>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageReaction {
    pub emoji: String,
    pub reactor: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    #[serde(rename = "_id")]
    pub id: String,
    pub chat_id: String,
    #[serde(rename = "senderId")]
    pub sender: Uuid,
    pub content: String,
    #[serde(default)]
    pub relates_to: Option<String>,
    #[serde(default)]
    pub created_at: Option<i64>,
    #[serde(default)]
    pub sent_at: Option<i64>,
    #[serde(default)]
    pub received_at: Option<i64>,
    #[serde(default)]
    pub read_at: Option<i64>,
    #[serde(default)]
    pub edited_at: Option<i64>,
    #[serde(default)]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    pub reactions: Vec<ChatMessageReaction>,
    #[serde(default)]
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedChat {
    #[serde(rename = "_id")]
    pub id: String,
    pub participants: Vec<ChatParticipant>,
    #[serde(rename = "type", default)]
    pub chat_type: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub timestamp: Option<i64>,
    #[serde(default)]
    pub group_avatar_url: Option<String>,
    #[serde(default)]
    pub unread_messages: u32,
    #[serde(default)]
    pub latest_message: Option<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatMessageRequest {
    pub content: String,
    pub relates_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditChatMessageRequest {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineStateChangeEvent {
    pub new_state: OnlineState,
    pub user: OnlineStateChangeUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineStateChangeUser {
    pub uuid: Uuid,
    pub ign: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendOnlineEvent {
    pub uuid: Uuid,
    pub username: String,
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReceivedEvent {
    pub chat_id: String,
    pub message: ChatMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTypingEvent {
    pub chat_id: String,
    pub user_uuid: Uuid,
    pub username: String,
}
