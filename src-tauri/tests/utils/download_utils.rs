use noriskclient_launcher_v3_lib::utils::download_utils::*;
use std::path::PathBuf;
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
