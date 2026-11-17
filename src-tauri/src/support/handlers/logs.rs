use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::support::files::{self, Redact, MAX_CRASH_AGE};
use crate::support::handler::{PreparedItem, SupportContext, SupportItemHandler};
use crate::support::types::{ItemCategory, ItemParams};
use crate::utils::log_archive;
use crate::utils::security_utils::{mask_sensitive_data, redact_hs_err};
use async_trait::async_trait;
use log::{debug, warn};
use once_cell::sync::Lazy;
use regex::Regex;
use std::path::{Path, PathBuf};

pub enum Located {
    Found { root: PathBuf, relative: PathBuf },
    Missing(String),
    Rejected(String),
}

pub type Summarize = fn(&str) -> Option<String>;

#[derive(Clone, Copy)]
pub struct FileItemHandler {
    pub type_id: &'static str,
    pub locate: fn(&SupportContext) -> Located,
    pub redact: Redact,
    pub summarize: Option<Summarize>,
}

fn mask_text(text: &str) -> Result<String, String> {
    Ok(mask_sensitive_data(text))
}

fn mask_hs_err(text: &str) -> Result<String, String> {
    Ok(redact_hs_err(text))
}

impl FileItemHandler {
    pub const fn plain(type_id: &'static str, locate: fn(&SupportContext) -> Located) -> Self {
        Self {
            type_id,
            locate,
            redact: mask_text,
            summarize: None,
        }
    }

    fn prepare_blocking(&self, ctx: &SupportContext) -> PreparedItem {
        let rejected = |reason: String| {
            warn!("[Support] {} rejected: {}", self.type_id, reason);
            PreparedItem::failed(format!("file rejected: {}", reason))
        };
        let (root, relative) = match (self.locate)(ctx) {
            Located::Found { root, relative } => (root, relative),
            Located::Missing(reason) => return PreparedItem::missing(reason),
            Located::Rejected(reason) => return rejected(reason),
        };
        let path = match files::resolve_safe_file(&root, &relative) {
            Ok(Some(p)) => p,
            Ok(None) => return PreparedItem::missing(format!("{} not found", relative.display())),
            Err(reason) => return rejected(format!("{:?}: {}", relative, reason)),
        };
        let (content, truncated) = match files::read_redacted(&path, ctx.file_byte_budget, self.redact) {
            Ok(r) => r,
            Err(e) => return PreparedItem::failed(e),
        };
        let summary = self
            .summarize
            .and_then(|f| f(&content))
            .or_else(|| Some(mask_sensitive_data(&relative.to_string_lossy())));
        debug!(
            "[Support] {} prepared from {:?} ({} bytes, truncated: {})",
            self.type_id,
            relative,
            content.len(),
            truncated
        );
        PreparedItem::file(content, summary, truncated)
    }
}

#[async_trait]
impl SupportItemHandler for FileItemHandler {
    fn type_id(&self) -> &'static str {
        self.type_id
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Collect
    }

    async fn prepare(&self, ctx: &SupportContext, _params: &ItemParams) -> PreparedItem {
        let handler = *self;
        let ctx = ctx.clone();
        tokio::task::spawn_blocking(move || handler.prepare_blocking(&ctx))
            .await
            .unwrap_or_else(|e| PreparedItem::failed(format!("internal error: {}", e)))
    }
}

pub(crate) fn found(root: &Path, relative: impl Into<PathBuf>) -> Located {
    Located::Found {
        root: root.to_path_buf(),
        relative: relative.into(),
    }
}

fn found_or(root: &Path, relative: Option<PathBuf>, missing: &str) -> Located {
    match relative {
        Some(relative) => found(root, relative),
        None => Located::Missing(missing.to_string()),
    }
}

pub fn locate_mc_latest_log(ctx: &SupportContext) -> Located {
    found(&ctx.instance_path, "logs/latest.log")
}

pub fn locate_mc_debug_log(ctx: &SupportContext) -> Located {
    found(&ctx.instance_path, "logs/debug.log")
}

pub fn locate_launcher_log(_ctx: &SupportContext) -> Located {
    found(&LAUNCHER_DIRECTORY.root_dir().join("logs"), "launcher.log")
}

pub fn locate_mc_latest_crash(ctx: &SupportContext) -> Located {
    found_or(
        &ctx.instance_path,
        files::newest_matching(
            &ctx.instance_path,
            Path::new("crash-reports"),
            |n| n.starts_with("crash-") && n.ends_with(".txt"),
            Some(MAX_CRASH_AGE),
        ),
        "no crash report from the last 14 days",
    )
}

pub fn locate_last_session_log(ctx: &SupportContext) -> Located {
    found_or(
        &log_archive::archive_root(),
        log_archive::newest_session_log_for_profile(ctx.profile.id),
        "no recorded game session for this profile",
    )
}

static HS_ERR_NAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"^hs_err_pid\d+\.log$").unwrap());
static HS_ERR_REFERENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r"hs_err_pid(\d+)\.log").unwrap());
const JVM_FATAL_MARKER: &str = "A fatal error has been detected by the Java Runtime Environment";
const JVM_BANNER_TAIL_BYTES: u64 = 2 * 1024 * 1024;

fn referenced_hs_err_pid(text: &str) -> Option<String> {
    let start = text.rfind(JVM_FATAL_MARKER)?;
    HS_ERR_REFERENCE
        .captures(&text[start..])
        .map(|c| c[1].to_string())
}

fn referenced_hs_err(ctx: &SupportContext) -> Option<PathBuf> {
    let session_log = log_archive::newest_session_log_for_profile(ctx.profile.id)
        .map(|relative| log_archive::archive_root().join(relative));
    let latest_log = ctx.instance_path.join("logs").join("latest.log");
    session_log
        .into_iter()
        .chain(std::iter::once(latest_log))
        .filter_map(|log| files::read_tail_lossy(&log, JVM_BANNER_TAIL_BYTES))
        .filter_map(|tail| referenced_hs_err_pid(&tail))
        .map(|pid| PathBuf::from(format!("hs_err_pid{}.log", pid)))
        .find(|name| ctx.instance_path.join(name).is_file())
}

pub fn locate_jvm_crash(ctx: &SupportContext) -> Located {
    let relative = referenced_hs_err(ctx).or_else(|| {
        files::newest_matching(
            &ctx.instance_path,
            Path::new(""),
            |n| HS_ERR_NAME.is_match(n),
            Some(MAX_CRASH_AGE),
        )
    });
    found_or(
        &ctx.instance_path,
        relative,
        "no JVM crash log (hs_err_pid*.log) from the last 14 days",
    )
}

pub fn summarize_hs_err(content: &str) -> Option<String> {
    let strip = |l: &str| l.trim_start_matches('#').trim().to_string();
    let lines: Vec<&str> = content.lines().take(400).collect();
    let exception = lines.iter().find(|l| l.contains(" at pc=")).map(|l| strip(l));
    let frame = lines
        .iter()
        .position(|l| l.contains("Problematic frame:"))
        .and_then(|i| lines.get(i + 1))
        .map(|l| strip(l))
        .filter(|l| !l.is_empty());
    match (exception, frame) {
        (Some(e), Some(f)) => Some(format!("{} | {}", e, f)),
        (e, f) => e.or(f),
    }
}

pub fn summarize_crash_report(content: &str) -> Option<String> {
    content
        .lines()
        .take(200)
        .find_map(|l| l.strip_prefix("Description:"))
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
}

pub fn handlers() -> Vec<FileItemHandler> {
    vec![
        FileItemHandler::plain("MC_LATEST_LOG", locate_mc_latest_log),
        FileItemHandler::plain("MC_DEBUG_LOG", locate_mc_debug_log),
        FileItemHandler {
            summarize: Some(summarize_crash_report),
            ..FileItemHandler::plain("MC_LATEST_CRASH", locate_mc_latest_crash)
        },
        FileItemHandler {
            redact: mask_hs_err,
            summarize: Some(summarize_hs_err),
            ..FileItemHandler::plain("JVM_CRASH", locate_jvm_crash)
        },
        FileItemHandler::plain("LAUNCHER_LOG", locate_launcher_log),
        FileItemHandler::plain("LAST_SESSION_LOG", locate_last_session_log),
    ]
}
