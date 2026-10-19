pub mod api;
pub mod error;
pub mod files;
pub mod handler;
pub mod handlers;
pub mod registry;
pub mod service;
pub mod types;

pub fn normalize_code(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let len = trimmed.len();
    if !(8..=40).contains(&len) {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some(trimmed.to_ascii_uppercase())
}
