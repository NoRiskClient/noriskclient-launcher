pub mod api;
pub mod error;
pub mod files;
pub mod follow_up;
pub mod handler;
pub mod handlers;
pub mod registry;
pub mod service;
pub mod types;

pub fn require_main_window(label: &str) -> Result<(), crate::error::CommandError> {
    if crate::utils::main_window::is_main(label) {
        return Ok(());
    }
    log::warn!("[Support] Rejected support command from window '{}'", label);
    Err(error::SupportError::new(error::SupportErrorKind::Forbidden).into())
}

const CODE_LENGTH: usize = 26;

pub fn normalize_code(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (trimmed.len() == CODE_LENGTH && trimmed.chars().all(|c| c.is_ascii_alphanumeric()))
        .then(|| trimmed.to_ascii_uppercase())
}
