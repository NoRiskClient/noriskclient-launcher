use crate::utils::serde_utils::deserialize_string_from_number;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type ItemParams = Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestedBy {
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minecraft_uuid: Option<String>,
    #[serde(default, skip_serializing)]
    pub discord_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestedItem {
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<ItemParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSupportRequest {
    #[serde(deserialize_with = "deserialize_string_from_number")]
    pub request_id: String,
    #[serde(deserialize_with = "deserialize_string_from_number")]
    pub ticket_id: String,
    pub ticket_number: i64,
    pub category: String,
    pub requested_by: RequestedBy,
    #[serde(default)]
    pub items: Vec<RequestedItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub created_at: Value,
    pub expires_at: Value,
    #[serde(default)]
    pub max_file_bytes: u64,
    #[serde(default)]
    pub max_total_bytes: u64,
    #[serde(default)]
    pub max_upload_bytes: u64,
    #[serde(default)]
    pub max_files: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountRef {
    pub id: String,
    pub ign: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportRequestInfo {
    pub code: String,
    #[serde(flatten)]
    pub request: RemoteSupportRequest,
    pub account: AccountRef,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItemCategory {
    Collect,
    Action,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPlanView {
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedItemView {
    pub index: usize,
    #[serde(rename = "type")]
    pub item_type: String,
    pub category: ItemCategory,
    pub supported: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub preview_is_excerpt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<ActionPlanView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrepareResult {
    pub items: Vec<PreparedItemView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareStep {
    pub index: usize,
    pub total: usize,
    pub item_type: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItemStatus {
    Done,
    Declined,
    Failed,
    Unsupported,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitItemResult {
    #[serde(rename = "type")]
    pub item_type: String,
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResults {
    pub launcher_version: String,
    pub capabilities: Vec<String>,
    pub items: Vec<SubmitItemResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResponse {
    #[serde(deserialize_with = "deserialize_string_from_number")]
    pub message_id: String,
}
