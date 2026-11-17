use once_cell::sync::Lazy;
use regex::Regex;

pub(super) const DEFAULT_MAX_BYTES: u64 = 5 * 1024 * 1024;
const HEAD_BYTES: usize = 1024 * 1024;
const MARKER_BYTES: usize = 64;

static CONTROLS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x08\x0b\x0c\x0e-\x1f]").unwrap());

pub fn prepare(raw: &str, max_bytes: usize) -> String {
    let clean = CONTROLS.replace_all(raw, "");
    let redacted = crate::utils::security_utils::mask_sensitive_data(&clean);
    fit(&redacted, max_bytes)
}

pub fn fit(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let budget = max_bytes.saturating_sub(MARKER_BYTES);
    let head_end = line_end_before(text, HEAD_BYTES.min(budget / 5));
    let tail_start = line_start_after(text, text.len() - (budget - head_end)).max(head_end);

    let cut = text[head_end..tail_start].matches('\n').count();
    let mut out = String::with_capacity(max_bytes);
    out.push_str(&text[..head_end]);
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!("----- {cut} lines cut -----\n"));
    out.push_str(&text[tail_start..]);
    out
}

fn line_end_before(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    text[..at].rfind('\n').map_or(at, |n| n + 1)
}

fn line_start_after(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at += 1;
    }
    text[at..].find('\n').map_or(at, |n| at + n + 1)
}
