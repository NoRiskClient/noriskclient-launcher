use noriskclient_launcher_v3_lib::utils::hash_utils::*;

#[test]
fn matches_independent_murmur2_reference() {
    assert_eq!(curseforge_fingerprint_from_bytes(b""), 1540447798);
    assert_eq!(
        curseforge_fingerprint_from_bytes(b"NoRiskClient"),
        3941284744
    );
    assert_eq!(curseforge_fingerprint_from_bytes(b"abc"), 1621425345);
    assert_eq!(curseforge_fingerprint_from_bytes(b"0123456789"), 3379062362);
}

#[test]
fn whitespace_is_stripped_before_hashing() {
    assert_eq!(
        curseforge_fingerprint_from_bytes(b"a\r\nb \tc"),
        curseforge_fingerprint_from_bytes(b"abc")
    );
    assert_eq!(
        curseforge_fingerprint_from_bytes(b" \t\r\n"),
        curseforge_fingerprint_from_bytes(b"")
    );
    assert_ne!(
        curseforge_fingerprint_from_bytes(b"abc"),
        curseforge_fingerprint_from_bytes(b"acb")
    );
}

#[tokio::test]
async fn file_and_byte_slice_agree() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sample.jar");

    let mut blob: Vec<u8> = (0..300_000u32).map(|i| (i % 253) as u8).collect();
    blob.extend_from_slice(b"trailing \t\r\n bytes");
    tokio::fs::write(&path, &blob).await.unwrap();

    assert_eq!(
        calculate_curseforge_fingerprint(&path).await.unwrap(),
        curseforge_fingerprint_from_bytes(&blob)
    );
}

#[tokio::test]
async fn empty_file_matches_empty_slice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.jar");
    tokio::fs::write(&path, b"").await.unwrap();

    assert_eq!(
        calculate_curseforge_fingerprint(&path).await.unwrap(),
        curseforge_fingerprint_from_bytes(b"")
    );
}

#[tokio::test]
async fn sha1_and_sha256_file_hashes_match_byte_slice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.bin");

    let blob: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    tokio::fs::write(&path, &blob).await.unwrap();

    assert_eq!(
        calculate_sha1(&path).await.unwrap(),
        calculate_sha1_from_bytes(&blob)
    );
    assert_eq!(
        calculate_sha256_from_file(&path).await.unwrap(),
        calculate_sha256_from_bytes(&blob)
    );
}

#[tokio::test]
async fn sha1_of_missing_file_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    assert!(calculate_sha1(&dir.path().join("nope.jar")).await.is_err());
}
