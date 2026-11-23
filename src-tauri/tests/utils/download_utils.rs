use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use noriskclient_launcher_v3_lib::error::AppError;
use noriskclient_launcher_v3_lib::utils::download_utils::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::fs;

const UNREACHABLE_URL: &str = "http://127.0.0.1:1/artifact.jar";

const CONTENT: &[u8] = b"hello";
const CONTENT_SHA1: &str = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";

fn offline_config() -> DownloadConfig {
    DownloadConfig::new()
        .with_retries(0)
        .with_disk_space_check(false)
}

async fn cached_file(dir: &tempfile::TempDir) -> PathBuf {
    let path = dir.path().join("artifact.bin");
    fs::write(&path, CONTENT).await.unwrap();
    path
}

#[tokio::test]
async fn cached_file_with_matching_sha1_skips_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config().with_sha1(CONTENT_SHA1),
    )
    .await;

    assert!(
        result.is_ok(),
        "cached file must launch offline: {result:?}"
    );
}

#[tokio::test]
async fn cached_file_with_matching_size_skips_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config().with_size(CONTENT.len() as u64),
    )
    .await;

    assert!(
        result.is_ok(),
        "cached file must launch offline: {result:?}"
    );
}

#[tokio::test]
async fn cached_file_without_expectations_skips_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(UNREACHABLE_URL, &path, offline_config()).await;

    assert!(result.is_ok(), "mere existence must satisfy: {result:?}");
}

#[tokio::test]
async fn cached_file_with_wrong_sha1_hits_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config().with_sha1("0000000000000000000000000000000000000000"),
    )
    .await;

    assert!(
        result.is_err(),
        "corrupt cache must not be silently accepted"
    );
}

#[tokio::test]
async fn cached_file_with_wrong_size_hits_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config().with_size(CONTENT.len() as u64 + 1),
    )
    .await;

    assert!(
        result.is_err(),
        "size mismatch must not be silently accepted"
    );
}

#[tokio::test]
async fn force_overwrite_ignores_cache() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config()
            .with_sha1(CONTENT_SHA1)
            .with_force_overwrite(true),
    )
    .await;

    assert!(
        result.is_err(),
        "force_overwrite must always hit the network"
    );
}

#[tokio::test]
async fn missing_file_hits_network() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("never-downloaded.bin");

    let result = DownloadUtils::download_file(UNREACHABLE_URL, &path, offline_config()).await;

    assert!(result.is_err(), "cold cache offline cannot succeed");
}

#[tokio::test]
async fn cached_file_skips_sha1_when_hashing_of_existing_files_is_off() {
    let dir = tempfile::tempdir().unwrap();
    let path = cached_file(&dir).await;

    let result = DownloadUtils::download_file(
        UNREACHABLE_URL,
        &path,
        offline_config()
            .with_sha1("0000000000000000000000000000000000000000")
            .with_size(CONTENT.len() as u64)
            .with_hash_existing_files(false),
    )
    .await;

    assert!(
        result.is_ok(),
        "sha1 is for the download path only here; size decides on disk: {result:?}"
    );
}

async fn serve(status: u16, body: &'static str) -> (Arc<AtomicUsize>, String) {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let app = Router::new().route(
        "/pack",
        get(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            async move { (StatusCode::from_u16(status).unwrap(), body) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/pack", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (hits, url)
}

async fn download_from(status: u16, body: &'static str) -> (usize, AppError) {
    let (hits, url) = serve(status, body).await;
    let dir = tempfile::tempdir().unwrap();
    let error = DownloadUtils::download_file(
        &url,
        dir.path().join("pack.bin"),
        DownloadConfig::new().with_retries(3).with_disk_space_check(false),
    )
    .await
    .unwrap_err();
    (hits.load(Ordering::SeqCst), error)
}

#[tokio::test]
async fn a_forbidden_download_is_not_retried_and_keeps_the_backend_key() {
    let (hits, error) =
        download_from(403, r#"{"translatableKey":"message.ticket.error.not_permitted","args":[]}"#).await;

    assert_eq!(hits, 1);
    assert!(matches!(
        error,
        AppError::ApiError { status: 403, ref translatable_key, .. } if translatable_key == "message.ticket.error.not_permitted"
    ));
}

#[tokio::test]
async fn a_missing_file_without_backend_key_keeps_its_status() {
    let (hits, error) = download_from(404, "nope").await;

    assert_eq!(hits, 1);
    assert!(matches!(error, AppError::HttpStatus { status: 404, .. }));
}

#[tokio::test]
async fn a_server_error_is_retried() {
    let (hits, _) = download_from(502, "").await;

    assert_eq!(hits, 4);
}

#[tokio::test]
async fn a_rate_limited_download_is_retried() {
    let (hits, _) = download_from(429, "").await;

    assert_eq!(hits, 4);
}
