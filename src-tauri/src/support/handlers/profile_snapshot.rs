use crate::commands::share::upload::{file_body, watch_upload};
use crate::error::AppError;
use crate::state::state_manager::State;
use crate::support::api;
use crate::support::error::{SupportError, SupportErrorKind, SupportResult};
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::handlers::param_str;
use crate::support::service::with_account_token;
use crate::support::types::{ItemCategory, ItemParams, ProfileLimits};
use crate::utils::export_utils::{emit_export_progress, ExportMode, ExportStep};
use crate::utils::profile_utils::export_profile_to_noriskpack;
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use uuid::Uuid;

const PACK_NAME: &str = "profile.noriskpack";

pub struct ProfileSnapshotHandler;

#[derive(Deserialize)]
struct ShareChoice {
    paths: Vec<PathBuf>,
}

pub fn requested_paths(params: &ItemParams, limits: Option<&ProfileLimits>) -> Vec<String> {
    let category_paths = limits.map(|l| &l.category_paths);
    let categories = param_str(params, "include")
        .unwrap_or_default()
        .split(',')
        .map(|wanted| wanted.trim().to_ascii_lowercase())
        .filter_map(|wanted| category_paths.and_then(|paths| paths.get(&wanted)).cloned())
        .flatten()
        .collect::<Vec<_>>();
    let globs = param_str(params, "paths")
        .unwrap_or_default()
        .lines()
        .map(|glob| {
            glob.trim()
                .split('/')
                .take_while(|segment| !segment.contains('*'))
                .collect::<Vec<_>>()
                .join("/")
        })
        .filter(|prefix| !prefix.is_empty());
    let mut seen = HashSet::new();
    categories.into_iter().chain(globs).filter(|path| seen.insert(path.clone())).collect()
}

pub fn pack_fits(size: u64, limits: Option<&ProfileLimits>) -> bool {
    limits.is_none_or(|l| l.max_pack_bytes == 0 || size <= l.max_pack_bytes)
}

pub fn share_error(error: &SupportError) -> String {
    log::warn!("[Support] Profile share failed: {}", error);
    error.kind.key().to_string()
}

async fn upload(
    pack: &Path,
    token: String,
    code: String,
    experimental: bool,
    report: impl Fn(ExportStep),
) -> SupportResult<()> {
    let file = tokio::fs::File::open(pack).await.map_err(AppError::Io)?;
    let size = file.metadata().await.map_err(AppError::Io)?.len();
    let sent = Arc::new(AtomicU64::new(0));
    let put = api::upload_profile_pack(
        &token,
        &code,
        experimental,
        size,
        file_body(file, size, sent.clone()),
    );
    report(ExportStep::uploading(0, size));
    watch_upload(put, &sent, size, |bytes| {
        report(if bytes >= size { ExportStep::checking() } else { ExportStep::uploading(bytes, size) })
    })
    .await
}

async fn share(ctx: &SupportContext) -> Result<ActionOutcome, String> {
    let session = ctx.session()?;
    let profile_id = ctx.profile()?.id;
    let choice: ShareChoice = ctx
        .choice
        .clone()
        .and_then(|value| serde_json::from_value(value).ok())
        .ok_or("invalid_choice")?;
    let temp = tempfile::tempdir().map_err(|e| share_error(&AppError::Io(e).into()))?;
    let pack = export_profile_to_noriskpack(
        profile_id,
        Some(temp.path().join(PACK_NAME)),
        Some(choice.paths),
        ExportMode::Support,
        session
            .profile_limits
            .as_ref()
            .map(|l| l.max_pack_bytes)
            .filter(|max| *max > 0),
    )
    .await
    .map_err(|e| share_error(&e.into()))?;
    let size = tokio::fs::metadata(&pack)
        .await
        .map_err(|e| share_error(&AppError::Io(e).into()))?.len();
    if !pack_fits(size, session.profile_limits.as_ref()) {
        let detail = format!("pack is {} bytes", size);
        return Err(share_error(&SupportError::with_detail(SupportErrorKind::TooLarge, detail)));
    }
    let state = State::get().await.map_err(|e| share_error(&e.into()))?;
    let event_id = Uuid::new_v4();
    let report = |step: ExportStep| {
        let state = state.clone();
        tokio::spawn(async move {
            let _ = emit_export_progress(&state, event_id, profile_id, step).await;
        });
    };
    with_account_token(session.account_id, session.is_experimental, |token| {
        upload(&pack, token, session.code.clone(), session.is_experimental, report)
    })
    .await
    .map_err(|e| share_error(&e))?;
    Ok(ActionOutcome::done_quiet(None))
}

#[async_trait]
impl SupportItemHandler for ProfileSnapshotHandler {
    fn type_id(&self) -> &'static str {
        "PROFILE_SNAPSHOT"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Collect
    }

    fn runs_on_confirm(&self) -> bool {
        true
    }

    async fn prepare(&self, ctx: &SupportContext, params: &ItemParams) -> PreparedItem {
        let summary = ctx.profile().ok().map(|p| p.name.clone());
        let limits = ctx.session().ok().and_then(|s| s.profile_limits.as_ref());
        PreparedItem::data(serde_json::json!({ "requested": requested_paths(params, limits) }), summary)
    }

    async fn execute(
        &self,
        ctx: &SupportContext,
        _params: &ItemParams,
        _prepared: &PreparedItem,
    ) -> ActionOutcome {
        share(ctx).await.unwrap_or_else(ActionOutcome::failed)
    }
}
