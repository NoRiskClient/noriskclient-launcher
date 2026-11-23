use crate::state::content_cache_state::FileHashEntry;
use crate::state::State;
use crate::utils::hash_utils;
use std::path::Path;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

async fn state() -> Option<Arc<State>> {
    if !State::initialized() {
        return None;
    }
    State::get().await.ok()
}

async fn size_and_mtime_ms(path: &Path) -> Option<(u64, u64)> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some((metadata.len(), modified.as_millis() as u64))
}

pub async fn is_verified(path: &Path, expected_sha1: Option<&str>) -> bool {
    let Some(state) = state().await else {
        return false;
    };
    let Some((size, mtime_ms)) = size_and_mtime_ms(path).await else {
        return false;
    };
    let Some(cached) = state
        .content_cache
        .get_file_hash(&path.to_string_lossy(), size, mtime_ms)
        .await
    else {
        return false;
    };
    expected_sha1.map_or(true, |expected| cached.eq_ignore_ascii_case(expected))
}

pub async fn mark_verified(path: &Path, sha1: Option<&str>) {
    let Some(state) = state().await else {
        return;
    };
    let Some((size, mtime_ms)) = size_and_mtime_ms(path).await else {
        return;
    };
    let sha1 = match sha1 {
        Some(sha1) => sha1.to_ascii_lowercase(),
        None => match hash_utils::calculate_sha1_from_file(path).await {
            Ok(sha1) => sha1,
            Err(_) => return,
        },
    };
    state
        .content_cache
        .put_file_hashes(vec![(
            path.to_string_lossy().into_owned(),
            FileHashEntry { size, mtime_ms, sha1 },
        )])
        .await;
}
