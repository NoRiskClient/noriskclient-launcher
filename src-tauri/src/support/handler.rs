use crate::state::profile_state::Profile;
use crate::support::files::preview_excerpt;
use crate::support::types::{ActionPlanView, ItemCategory, ItemParams, ItemStatus};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct SupportContext {
    pub profile: Profile,
    pub instance_path: PathBuf,
    pub file_byte_budget: u64,
}

#[derive(Debug, Clone, Default)]
pub struct PreparedItem {
    pub available: bool,
    pub summary: Option<String>,
    pub file: Option<Arc<String>>,
    pub data: Option<Value>,
    pub truncated: bool,
    pub action: Option<ActionPlanView>,
    pub error: Option<String>,
    pub plan_state: Option<Value>,
    pub note: Option<String>,
}

impl PreparedItem {
    pub fn missing(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            summary: Some(reason.into()),
            ..Default::default()
        }
    }

    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            available: false,
            error: Some(error.into()),
            ..Default::default()
        }
    }

    pub fn file(content: String, summary: Option<String>, truncated: bool) -> Self {
        Self {
            available: true,
            summary,
            file: Some(Arc::new(content)),
            truncated,
            ..Default::default()
        }
    }

    pub fn data(data: Value, summary: Option<String>) -> Self {
        Self {
            available: true,
            summary,
            data: Some(data),
            ..Default::default()
        }
    }

    pub fn action(plan: ActionPlanView, plan_state: Value) -> Self {
        Self {
            available: true,
            summary: Some(plan.description.clone()),
            action: Some(plan),
            plan_state: Some(plan_state),
            ..Default::default()
        }
    }

    pub fn plan_str(&self, key: &str) -> Option<&str> {
        self.plan_state.as_ref()?.get(key)?.as_str()
    }

    pub fn preview(&self) -> (Option<String>, bool) {
        if let Some(file) = &self.file {
            let (text, excerpt) = preview_excerpt(file);
            return (Some(text), excerpt);
        }
        (
            self.data
                .as_ref()
                .map(|d| serde_json::to_string_pretty(d).unwrap_or_else(|_| d.to_string())),
            false,
        )
    }

    pub fn size_bytes(&self) -> Option<u64> {
        if let Some(file) = &self.file {
            return Some(file.len() as u64);
        }
        self.data
            .as_ref()
            .map(|d| serde_json::to_vec(d).map_or(0, |s| s.len() as u64))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ActionOutcome {
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl ActionOutcome {
    pub fn done(message: impl Into<String>, data: Option<Value>) -> Self {
        Self {
            status: ItemStatus::Done,
            message: Some(message.into()),
            data,
        }
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            status: ItemStatus::Failed,
            message: Some(message.into()),
            data: None,
        }
    }
}

#[async_trait]
pub trait SupportItemHandler: Send + Sync {
    fn type_id(&self) -> &'static str;

    fn category(&self) -> ItemCategory;

    async fn prepare(&self, ctx: &SupportContext, params: &ItemParams) -> PreparedItem;

    async fn execute(
        &self,
        _ctx: &SupportContext,
        _params: &ItemParams,
        _prepared: &PreparedItem,
    ) -> ActionOutcome {
        ActionOutcome::failed("not an action")
    }
}
