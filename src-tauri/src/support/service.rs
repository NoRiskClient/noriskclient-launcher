use crate::state::state_manager::State;
use crate::support::api::{self, UploadFile};
use crate::support::error::{SupportError, SupportErrorKind, SupportResult};
use crate::support::files::truncate_middle;
use crate::support::handler::{ActionOutcome, PreparedItem, SupportContext, SupportItemHandler};
use crate::support::registry::{capabilities, REGISTRY};
use crate::support::types::{
    AccountRef, ItemCategory, ItemParams, ItemStatus, PrepareResult, PrepareStep, PreparedItemView,
    RemoteSupportRequest, SubmitItemResult, SubmitResponse, SubmitResults, SupportRequestInfo,
};
use crate::utils::security_utils::mask_sensitive_data;
use log::{info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

const MB: u64 = 1024 * 1024;
const HARD_MAX_FILE_BYTES: u64 = 200 * MB;
const HARD_MAX_TOTAL_BYTES: u64 = 500 * MB;
const HARD_MAX_UPLOAD_BYTES: u64 = 100 * MB;
const HARD_MAX_FILES: u64 = 8;
const MIN_SHRUNK_FILE_BYTES: u64 = 64 * 1024;
const MAX_SHRINK_ROUNDS: usize = 32;
const SESSION_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_SESSIONS: usize = 4;
const OTHER_ACCOUNTS_AVAILABLE: &str = "other_accounts_available";
const TRUNCATED_MESSAGE: &str = "truncated by the launcher (head and tail kept)";

#[derive(Clone)]
pub struct PreparedEntry {
    pub item_type: String,
    pub params: ItemParams,
    pub handler: Option<&'static dyn SupportItemHandler>,
    pub prepared: Option<PreparedItem>,
    pub outcome: Option<ActionOutcome>,
    pub running: bool,
}

impl PreparedEntry {
    pub fn new(
        item_type: impl Into<String>,
        handler: Option<&'static dyn SupportItemHandler>,
        prepared: Option<PreparedItem>,
    ) -> Self {
        Self {
            item_type: item_type.into(),
            params: ItemParams::new(),
            handler,
            prepared,
            outcome: None,
            running: false,
        }
    }

    fn category(&self) -> Option<ItemCategory> {
        self.handler.map(|h| h.category())
    }

    fn is_action(&self) -> bool {
        self.category() == Some(ItemCategory::Action)
    }

    fn file_len(&self) -> Option<u64> {
        Some(self.prepared.as_ref()?.file.as_ref()?.len() as u64)
    }
}

#[derive(Clone)]
struct PreparedSet {
    ctx: SupportContext,
    entries: Vec<PreparedEntry>,
}

impl PreparedSet {
    fn running(&self) -> bool {
        self.entries.iter().any(|e| e.running)
    }
}

#[derive(Clone)]
struct SupportSession {
    request: RemoteSupportRequest,
    account_id: Uuid,
    is_experimental: bool,
    prepared: Option<PreparedSet>,
    created: Instant,
}

impl SupportSession {
    fn running(&self) -> bool {
        self.prepared.as_ref().is_some_and(PreparedSet::running)
    }

    fn ensure_can_prepare(&self, account_id: Uuid, profile_id: Uuid) -> SupportResult<()> {
        if self.account_id != account_id {
            return Err(SupportError::unknown(
                "account does not match the loaded request",
            ));
        }
        let Some(previous) = &self.prepared else {
            return Ok(());
        };
        if previous.running() {
            return Err(SupportError::new(SupportErrorKind::Busy));
        }
        if previous.ctx.profile.id != profile_id && previous.entries.iter().any(|e| e.outcome.is_some())
        {
            return Err(SupportError::unknown(
                "an action was already executed for another profile",
            ));
        }
        Ok(())
    }
}

type Sessions = HashMap<String, SupportSession>;

static SESSIONS: Lazy<Mutex<Sessions>> = Lazy::new(|| Mutex::new(HashMap::new()));

async fn sessions() -> tokio::sync::MutexGuard<'static, Sessions> {
    let mut guard = SESSIONS.lock().await;
    guard.retain(|_, s| s.created.elapsed() < SESSION_TTL);
    guard
}

pub async fn open_session(
    raw_code: &str,
    request: RemoteSupportRequest,
    account_id: Uuid,
    is_experimental: bool,
) -> SupportResult<()> {
    let code = require_code(raw_code)?;
    let mut map = sessions().await;
    if map.get(&code).is_some_and(SupportSession::running) {
        return Err(SupportError::new(SupportErrorKind::Busy));
    }
    insert_session(
        &mut map,
        code,
        SupportSession {
            request,
            account_id,
            is_experimental,
            prepared: None,
            created: Instant::now(),
        },
    );
    Ok(())
}

fn insert_session(map: &mut Sessions, code: String, session: SupportSession) {
    map.remove(&code);
    while map.len() >= MAX_SESSIONS {
        let Some(oldest) = map
            .iter()
            .min_by_key(|(_, s)| s.created)
            .map(|(k, _)| k.clone())
        else {
            break;
        };
        map.remove(&oldest);
    }
    map.insert(code, session);
}

fn require_code(raw: &str) -> SupportResult<String> {
    super::normalize_code(raw).ok_or_else(|| SupportError::new(SupportErrorKind::InvalidCode))
}

async fn session(code: &str) -> SupportResult<SupportSession> {
    sessions()
        .await
        .get(code)
        .cloned()
        .ok_or_else(SupportError::not_loaded)
}

pub async fn close(raw_code: &str) -> SupportResult<()> {
    let code = require_code(raw_code)?;
    sessions().await.remove(&code);
    Ok(())
}

async fn cached_token(
    account_id: Uuid,
    experimental: bool,
) -> SupportResult<(Option<String>, String)> {
    let state = State::get().await.map_err(SupportError::from)?;
    let creds = state
        .minecraft_account_manager_v2
        .get_account_by_id(account_id)
        .await
        .map_err(SupportError::from)?
        .ok_or_else(|| SupportError::new(SupportErrorKind::NotLoggedIn))?;
    let token = creds
        .norisk_credentials
        .get_token_for_mode(experimental)
        .ok();
    Ok((token, creds.username))
}

async fn refreshed_token(account_id: Uuid, experimental: bool) -> SupportResult<String> {
    State::get()
        .await?
        .minecraft_account_manager_v2
        .get_account_by_id_with_refresh(account_id, experimental)
        .await?
        .ok_or_else(|| SupportError::new(SupportErrorKind::NotLoggedIn))?
        .norisk_credentials
        .get_token_for_mode(experimental)
        .map_err(|_| SupportError::new(SupportErrorKind::NotLoggedIn))
}

async fn with_account_token<T, F, Fut>(
    account_id: Uuid,
    experimental: bool,
    call: F,
) -> SupportResult<(T, String)>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = SupportResult<T>>,
{
    let (token, username) = cached_token(account_id, experimental).await?;
    let first = match token {
        Some(token) => call(token).await,
        None => Err(SupportError::new(SupportErrorKind::NotLoggedIn)),
    };
    match first {
        Err(e) if e.kind == SupportErrorKind::NotLoggedIn => {
            let token = refreshed_token(account_id, experimental).await?;
            Ok((call(token).await?, username))
        }
        other => other.map(|v| (v, username)),
    }
}

fn ends_session<T>(outcome: &SupportResult<T>) -> bool {
    match outcome {
        Ok(_) => true,
        Err(e) => e.kind == SupportErrorKind::Gone,
    }
}

pub async fn fetch(raw_code: &str, try_other_accounts: bool) -> SupportResult<SupportRequestInfo> {
    let code = require_code(raw_code)?;
    let state = State::get().await?;
    let experimental = state.config_manager.is_experimental_mode().await;
    let all_accounts = state
        .minecraft_account_manager_v2
        .get_all_accounts()
        .await
        .unwrap_or_default();
    let active_id = all_accounts.iter().find(|a| a.active).map(|a| a.id);

    let mut candidates: Vec<Uuid> = active_id.into_iter().collect();
    if try_other_accounts || active_id.is_none() {
        for account in &all_accounts {
            if !candidates.contains(&account.id) {
                candidates.push(account.id);
            }
        }
    }
    if candidates.is_empty() {
        return Err(SupportError::new(SupportErrorKind::NotLoggedIn));
    }
    let others_available = all_accounts.iter().any(|a| Some(a.id) != active_id);

    let mut tried_any = false;
    let mut discord_not_linked = false;
    for account_id in candidates {
        let result = with_account_token(account_id, experimental, |token| {
            let code = code.clone();
            async move { api::fetch(&token, &code, experimental).await }
        })
        .await;
        match result {
            Ok((request, username)) => {
                info!(
                    "[Support] Request loaded for ticket #{} ({} item(s))",
                    request.ticket_number,
                    request.items.len()
                );
                let info = SupportRequestInfo {
                    code: code.clone(),
                    request: request.clone(),
                    account: AccountRef {
                        id: account_id.to_string(),
                        ign: username,
                    },
                    capabilities: capabilities(),
                };
                open_session(&code, request, account_id, experimental).await?;
                return Ok(info);
            }
            Err(e) if e.kind == SupportErrorKind::NotFound => tried_any = true,
            Err(e) if e.kind == SupportErrorKind::DiscordNotLinked => {
                tried_any = true;
                discord_not_linked = true;
            }
            Err(e) if e.kind == SupportErrorKind::NotLoggedIn => {
                warn!(
                    "[Support] Account {} has no valid NoRisk session",
                    account_id
                );
            }
            Err(e) => return Err(e),
        }
    }

    if !tried_any {
        return Err(SupportError::new(SupportErrorKind::NotLoggedIn));
    }
    if !try_other_accounts && others_available {
        return Err(SupportError::with_detail(
            SupportErrorKind::NotFound,
            OTHER_ACCOUNTS_AVAILABLE,
        ));
    }
    if discord_not_linked {
        Err(SupportError::new(SupportErrorKind::DiscordNotLinked))
    } else {
        Err(SupportError::new(SupportErrorKind::NotFound))
    }
}

#[derive(Debug, Clone, Copy)]
struct Limits {
    file: u64,
    total: u64,
    upload: u64,
    files: usize,
}

fn limits(request: &RemoteSupportRequest) -> Limits {
    let cap = |v: u64, hard: u64| if v == 0 { hard } else { v.min(hard) };
    Limits {
        file: cap(request.max_file_bytes, HARD_MAX_FILE_BYTES),
        total: cap(request.max_total_bytes, HARD_MAX_TOTAL_BYTES),
        upload: cap(request.max_upload_bytes, HARD_MAX_UPLOAD_BYTES),
        files: cap(u64::from(request.max_files), HARD_MAX_FILES) as usize,
    }
}

pub fn gzip(text: &str) -> std::io::Result<Vec<u8>> {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(
        Vec::with_capacity(text.len() / 8),
        flate2::Compression::default(),
    );
    encoder.write_all(text.as_bytes())?;
    encoder.finish()
}

fn fit_total_decompressed(entries: &mut [PreparedEntry], max_total: u64) {
    for _ in 0..MAX_SHRINK_ROUNDS {
        let sizes: Vec<(usize, u64)> = entries
            .iter()
            .enumerate()
            .filter_map(|(i, e)| e.file_len().map(|len| (i, len)))
            .collect();
        let total: u64 = sizes.iter().map(|(_, s)| s).sum();
        if total <= max_total {
            return;
        }
        let Some(&(index, size)) = sizes.iter().max_by_key(|(_, s)| *s) else {
            return;
        };
        let target = size
            .saturating_sub(total - max_total)
            .max(MIN_SHRUNK_FILE_BYTES);
        let Some(prepared) = entries[index].prepared.as_mut() else {
            return;
        };
        let Some(file) = prepared.file.as_mut() else {
            return;
        };
        let (shrunk, cut) = truncate_middle(file, target);
        if !cut {
            return;
        }
        *file = Arc::new(shrunk);
        prepared.truncated = true;
    }
}

fn view(index: usize, entry: &PreparedEntry) -> PreparedItemView {
    let prepared = entry.prepared.as_ref();
    let (preview, preview_is_excerpt) = prepared.map_or((None, false), PreparedItem::preview);
    PreparedItemView {
        index,
        item_type: entry.item_type.clone(),
        category: entry.category().unwrap_or(ItemCategory::Collect),
        supported: entry.handler.is_some(),
        available: prepared.is_some_and(|p| p.available),
        summary: prepared.and_then(|p| p.summary.clone()),
        size_bytes: prepared.and_then(PreparedItem::size_bytes),
        truncated: prepared.is_some_and(|p| p.truncated),
        preview,
        preview_is_excerpt,
        action: prepared.and_then(|p| p.action.clone()),
        error: if entry.handler.is_some() {
            prepared.and_then(|p| p.error.clone())
        } else {
            Some("unsupported".to_string())
        },
    }
}

pub async fn prepare(
    raw_code: &str,
    profile_id: Uuid,
    account_id: Uuid,
    on_step: impl Fn(PrepareStep),
) -> SupportResult<PrepareResult> {
    let code = require_code(raw_code)?;
    let session = session(&code).await?;
    session.ensure_can_prepare(account_id, profile_id)?;

    let state = State::get().await?;
    let profile = state
        .profile_manager
        .get_profile(profile_id)
        .await
        .map_err(|e| SupportError::unknown(format!("profile: {}", e)))?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await
        .map_err(|e| SupportError::unknown(format!("profile path: {}", e)))?;
    let limits = limits(&session.request);
    let ctx = SupportContext {
        profile,
        instance_path,
        file_byte_budget: limits.file,
    };

    let mut entries = Vec::with_capacity(session.request.items.len());
    let mut files_used = 0usize;
    let total = session.request.items.len();
    for (index, item) in session.request.items.iter().enumerate() {
        on_step(PrepareStep {
            index,
            total,
            item_type: item.item_type.clone(),
        });
        let mut entry = PreparedEntry {
            params: item.params.clone().unwrap_or_default(),
            ..PreparedEntry::new(item.item_type.clone(), REGISTRY.get(&item.item_type), None)
        };
        if let Some(handler) = entry.handler {
            let mut prepared = handler.prepare(&ctx, &entry.params).await;
            if prepared.file.is_some() {
                if files_used >= limits.files {
                    prepared = PreparedItem::failed("too_large: file limit of this request reached");
                } else {
                    files_used += 1;
                }
            }
            entry.prepared = Some(prepared);
        }
        entries.push(entry);
    }

    fit_total_decompressed(&mut entries, limits.total);
    let items = entries
        .iter()
        .enumerate()
        .map(|(i, e)| view(i, e))
        .collect();

    store_prepared(&code, account_id, ctx, entries).await?;
    Ok(PrepareResult { items })
}

pub async fn store_prepared(
    raw_code: &str,
    account_id: Uuid,
    ctx: SupportContext,
    mut entries: Vec<PreparedEntry>,
) -> SupportResult<()> {
    let code = require_code(raw_code)?;
    let profile_id = ctx.profile.id;
    let mut map = sessions().await;
    let stored = map.get_mut(&code).ok_or_else(SupportError::not_loaded)?;
    stored.ensure_can_prepare(account_id, profile_id)?;
    if let Some(previous) = &stored.prepared {
        for (entry, old) in entries.iter_mut().zip(&previous.entries) {
            entry.outcome = old.outcome.clone();
        }
    }
    stored.prepared = Some(PreparedSet { ctx, entries });
    Ok(())
}

async fn run_action(ctx: SupportContext, mut entry: PreparedEntry) -> ActionOutcome {
    let (Some(handler), Some(prepared)) = (entry.handler, entry.prepared.take()) else {
        return ActionOutcome::failed("item is not supported");
    };
    tokio::spawn(async move { handler.execute(&ctx, &entry.params, &prepared).await })
        .await
        .unwrap_or_else(|e| ActionOutcome::failed(format!("internal error: {}", e)))
}

pub async fn execute_action(raw_code: &str, index: usize) -> SupportResult<ActionOutcome> {
    let code = require_code(raw_code)?;

    let (ctx, entry) = {
        let mut map = sessions().await;
        let set = map
            .get_mut(&code)
            .ok_or_else(SupportError::not_loaded)?
            .prepared
            .as_mut()
            .ok_or_else(SupportError::not_prepared)?;
        let ctx = set.ctx.clone();
        let entry = set
            .entries
            .get_mut(index)
            .ok_or_else(|| SupportError::unknown("no such item"))?;
        if !entry.is_action() {
            return Err(SupportError::unknown("item is not an action"));
        }
        if entry.running {
            return Err(SupportError::new(SupportErrorKind::Busy));
        }
        if let Some(outcome) = entry.outcome.as_ref().filter(|o| o.status == ItemStatus::Done) {
            return Ok(outcome.clone());
        }
        let prepared = entry.prepared.as_ref().ok_or_else(SupportError::not_prepared)?;
        if let Some(error) = &prepared.error {
            return Err(SupportError::unknown(error.clone()));
        }
        entry.running = true;
        entry.outcome = None;
        (ctx, entry.clone())
    };

    info!(
        "[Support] User confirmed action {} (#{})",
        entry.item_type, index
    );
    let outcome = run_action(ctx, entry).await;

    if let Some(stored) = sessions()
        .await
        .get_mut(&code)
        .and_then(|s| s.prepared.as_mut())
        .and_then(|set| set.entries.get_mut(index))
    {
        stored.running = false;
        stored.outcome = Some(outcome.clone());
    }
    Ok(outcome)
}

pub struct PendingFile {
    pub result_index: usize,
    pub part_name: String,
    pub content: Arc<String>,
}

fn item_result(
    index: usize,
    entry: &PreparedEntry,
    selection: &[usize],
) -> (SubmitItemResult, Option<Arc<String>>) {
    let result = |status: ItemStatus, message: Option<String>, data: Option<serde_json::Value>| {
        SubmitItemResult {
            item_type: entry.item_type.clone(),
            status,
            message: message.map(|m| mask_sensitive_data(&m)),
            data,
        }
    };
    let Some(category) = entry.category() else {
        return (result(ItemStatus::Unsupported, None, None), None);
    };
    if let Some(outcome) = &entry.outcome {
        let r = result(outcome.status, outcome.message.clone(), outcome.data.clone());
        return (r, None);
    }
    let Some(prepared) = entry.prepared.as_ref() else {
        return (result(ItemStatus::Failed, Some("not prepared".into()), None), None);
    };
    if let Some(error) = &prepared.error {
        return (result(ItemStatus::Failed, Some(error.clone()), None), None);
    }
    let status = match category {
        ItemCategory::Action => ItemStatus::Declined,
        ItemCategory::Collect if !prepared.available => ItemStatus::Missing,
        ItemCategory::Collect if !selection.contains(&index) => ItemStatus::Declined,
        ItemCategory::Collect => ItemStatus::Done,
    };
    match status {
        ItemStatus::Missing => (result(status, prepared.summary.clone(), None), None),
        ItemStatus::Done => {
            let message = prepared
                .note
                .clone()
                .or_else(|| prepared.truncated.then(|| TRUNCATED_MESSAGE.to_string()));
            (
                result(status, message, prepared.data.clone()),
                prepared.file.clone(),
            )
        }
        _ => (result(status, None, None), None),
    }
}

pub fn build_submission(
    entries: &[PreparedEntry],
    selection: &[usize],
) -> (Vec<SubmitItemResult>, Vec<PendingFile>) {
    let mut results = Vec::with_capacity(entries.len());
    let mut files = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let (result, file) = item_result(index, entry, selection);
        if let Some(content) = file {
            files.push(PendingFile {
                result_index: index,
                part_name: entry.item_type.clone(),
                content,
            });
        }
        results.push(result);
    }
    (results, files)
}

fn too_large(total: u64, max: u64, unit: &str) -> SupportError {
    SupportError::with_detail(
        SupportErrorKind::TooLarge,
        format!("{} {} > {} bytes", total, unit, max),
    )
}

pub fn compress_to_fit(
    files: Vec<PendingFile>,
    max_upload: u64,
) -> SupportResult<(Vec<UploadFile>, Vec<usize>)> {
    let to_err = |e: std::io::Error| SupportError::unknown(format!("compression failed: {}", e));
    let mut compressed: Vec<Vec<u8>> = files
        .iter()
        .map(|f| gzip(&f.content))
        .collect::<std::io::Result<_>>()
        .map_err(to_err)?;
    let mut texts: Vec<Arc<String>> = files.iter().map(|f| f.content.clone()).collect();
    let mut cut: Vec<usize> = Vec::new();
    let compressed_total = |c: &[Vec<u8>]| c.iter().map(|b| b.len() as u64).sum::<u64>();

    for _ in 0..MAX_SHRINK_ROUNDS {
        let total = compressed_total(&compressed);
        if total <= max_upload {
            break;
        }
        let Some(i) = (0..compressed.len()).max_by_key(|&i| compressed[i].len()) else {
            break;
        };
        let current = compressed[i].len() as u64;
        let decompressed = texts[i].len() as u64;
        let allowed = current.saturating_sub(total - max_upload);
        let ratio = decompressed as f64 / current.max(1) as f64;
        let target = ((allowed as f64 * ratio) * 0.95) as u64;
        if target < MIN_SHRUNK_FILE_BYTES || decompressed <= MIN_SHRUNK_FILE_BYTES {
            return Err(too_large(total, max_upload, "compressed bytes"));
        }
        let (text, was_cut) = truncate_middle(&texts[i], target);
        if !was_cut {
            return Err(SupportError::new(SupportErrorKind::TooLarge));
        }
        compressed[i] = gzip(&text).map_err(to_err)?;
        texts[i] = Arc::new(text);
        if !cut.contains(&files[i].result_index) {
            cut.push(files[i].result_index);
        }
    }
    let total = compressed_total(&compressed);
    if total > max_upload {
        return Err(too_large(total, max_upload, "compressed bytes"));
    }
    let parts = files
        .into_iter()
        .zip(compressed)
        .map(|(f, gzip_bytes)| UploadFile {
            part_name: f.part_name,
            gzip_bytes,
        })
        .collect();
    Ok((parts, cut))
}

async fn refresh_action_results(code: &str, items: &mut [SubmitItemResult]) -> SupportResult<()> {
    let map = sessions().await;
    let set = map
        .get(code)
        .ok_or_else(SupportError::not_loaded)?
        .prepared
        .as_ref()
        .ok_or_else(SupportError::not_prepared)?;
    if set.running() {
        return Err(SupportError::new(SupportErrorKind::Busy));
    }
    for (index, entry) in set.entries.iter().enumerate() {
        if entry.is_action() {
            if let Some(item) = items.get_mut(index) {
                *item = item_result(index, entry, &[]).0;
            }
        }
    }
    Ok(())
}

pub async fn submit(
    raw_code: &str,
    selection: Vec<usize>,
    launcher_version: String,
) -> SupportResult<SubmitResponse> {
    let code = require_code(raw_code)?;
    let session = session(&code).await?;
    if session.running() {
        return Err(SupportError::new(SupportErrorKind::Busy));
    }
    let set = session
        .prepared
        .as_ref()
        .ok_or_else(SupportError::not_prepared)?;

    let (mut items, pending_files) = build_submission(&set.entries, &selection);
    let limits = limits(&session.request);
    let decompressed: u64 = pending_files.iter().map(|f| f.content.len() as u64).sum();
    if decompressed > limits.total {
        return Err(too_large(decompressed, limits.total, "bytes"));
    }
    let (files, cut) =
        tokio::task::spawn_blocking(move || compress_to_fit(pending_files, limits.upload))
            .await
            .map_err(|e| SupportError::unknown(format!("compression task failed: {}", e)))??;
    for index in cut {
        if let Some(item) = items.get_mut(index) {
            item.message = Some(TRUNCATED_MESSAGE.to_string());
        }
    }
    refresh_action_results(&code, &mut items).await?;
    let total: u64 = files.iter().map(|f| f.gzip_bytes.len() as u64).sum();
    info!(
        "[Support] Submitting request for ticket #{} ({} file(s), {} bytes decompressed, {} bytes gzip)",
        session.request.ticket_number,
        files.len(),
        decompressed,
        total
    );

    let results = Arc::new(SubmitResults {
        launcher_version,
        capabilities: capabilities(),
        items,
    });
    let files = Arc::new(files);
    let experimental = session.is_experimental;
    let outcome = with_account_token(session.account_id, experimental, |token| {
        let (code, results, files) = (code.clone(), results.clone(), files.clone());
        async move { api::submit(&token, &code, experimental, &results, &files).await }
    })
    .await
    .map(|(response, _)| response);
    if ends_session(&outcome) {
        sessions().await.remove(&code);
    }
    outcome
}

pub async fn decline(raw_code: &str) -> SupportResult<()> {
    let code = require_code(raw_code)?;
    let session = session(&code).await?;
    info!(
        "[Support] Declining request for ticket #{}",
        session.request.ticket_number
    );
    let experimental = session.is_experimental;
    let outcome = with_account_token(session.account_id, experimental, |token| {
        let code = code.clone();
        async move { api::decline(&token, &code, experimental).await }
    })
    .await
    .map(|_| ());
    if ends_session(&outcome) {
        sessions().await.remove(&code);
    }
    outcome
}
