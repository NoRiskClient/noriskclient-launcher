use noriskclient_launcher_v3_lib::state::profile_state::{Mod, Profile};
use noriskclient_launcher_v3_lib::utils::content_copy::*;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;

fn profile(game_version: &str, loader: &str, mods: Vec<serde_json::Value>) -> Profile {
    serde_json::from_value(serde_json::json!({
        "name": "test",
        "path": "test",
        "game_version": game_version,
        "loader": loader,
        "mods": mods,
    }))
    .expect("profile fixture must deserialize")
}

fn modrinth(project_id: &str) -> serde_json::Value {
    serde_json::json!({
        "source": {
            "type": "modrinth",
            "project_id": project_id,
            "version_id": format!("{project_id}-v1"),
            "file_name": format!("{project_id}.jar"),
            "download_url": "",
            "file_hash_sha1": null
        },
        "enabled": false,
        "display_name": project_id,
        "version": "1.0",
        "game_versions": ["1.21.11"],
        "file_name_override": null,
        "modpack_origin": "modrinth:somepack",
        "updates_enabled": false
    })
}

fn local(file_name: &str) -> serde_json::Value {
    serde_json::json!({
        "source": { "type": "local", "file_name": file_name },
        "enabled": true,
        "display_name": file_name,
        "version": null,
        "game_versions": null,
        "file_name_override": null
    })
}

fn only_mod(profile: &Profile) -> &Mod {
    &profile.mods[0]
}

#[test]
fn same_version_and_loader_keeps_the_exact_version() {
    let source = profile("1.21.11", "fabric", vec![modrinth("sodium")]);
    let target = profile("1.21.11", "fabric", vec![]);

    assert_eq!(
        plan_mod_copy(only_mod(&source), &source, &target),
        ModCopy::Keep
    );
}

#[test]
fn another_version_resolves_a_matching_one() {
    let source = profile("1.21.11", "fabric", vec![modrinth("sodium")]);

    assert_eq!(
        plan_mod_copy(
            only_mod(&source),
            &source,
            &profile("1.21.4", "fabric", vec![])
        ),
        ModCopy::Resolve
    );
    assert_eq!(
        plan_mod_copy(
            only_mod(&source),
            &source,
            &profile("1.21.11", "neoforge", vec![])
        ),
        ModCopy::Resolve
    );
}

#[test]
fn a_vanilla_target_keeps_the_mod_for_a_later_loader_switch() {
    let source = profile("1.21.11", "fabric", vec![modrinth("sodium")]);

    assert_eq!(
        plan_mod_copy(
            only_mod(&source),
            &source,
            &profile("1.21.11", "vanilla", vec![])
        ),
        ModCopy::Inactive
    );
}

#[test]
fn a_project_the_target_already_has_is_skipped() {
    let source = profile("1.21.11", "fabric", vec![modrinth("sodium")]);
    let target = profile("1.21.4", "fabric", vec![modrinth("sodium")]);

    assert_eq!(
        plan_mod_copy(only_mod(&source), &source, &target),
        ModCopy::AlreadyThere
    );
}

#[test]
fn a_mod_without_a_platform_is_copied_as_its_file() {
    let source = profile("1.21.11", "fabric", vec![local("own.jar")]);
    let target = profile("1.21.11", "fabric", vec![]);

    assert_eq!(
        plan_mod_copy(only_mod(&source), &source, &target),
        ModCopy::AsFile
    );
}

#[test]
fn a_copy_is_a_new_entry_that_keeps_the_users_choices() {
    let source = profile("1.21.11", "fabric", vec![modrinth("sodium")]);
    let original = only_mod(&source);

    let copy = copied_mod(original);

    assert_ne!(copy.id, original.id);
    assert_eq!(copy.source, original.source);
    assert_eq!(copy.enabled, original.enabled);
    assert_eq!(copy.updates_enabled, original.updates_enabled);
    assert_eq!(copy.modpack_origin, None);
}

#[test]
fn only_direct_children_of_a_content_folder_may_be_copied() {
    let root = Path::new("/profiles/a/resourcepacks");
    let roots = vec![root.to_path_buf()];

    assert!(is_copyable_path(&root.join("pack.zip"), &roots));
    assert!(!is_copyable_path(
        &root.join("sub").join("pack.zip"),
        &roots
    ));
    assert!(!is_copyable_path(
        &root.join("..").join("options.txt"),
        &roots
    ));
    assert!(!is_copyable_path(
        Path::new("/profiles/b/resourcepacks/pack.zip"),
        &roots
    ));
}

fn io() -> Arc<Semaphore> {
    Arc::new(Semaphore::new(4))
}

#[tokio::test]
async fn a_file_is_copied_with_its_disabled_state() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("from");
    let dest = dir.path().join("to");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("pack.zip.disabled"), b"pack").unwrap();

    let outcome = copy_content_entry(&src.join("pack.zip.disabled"), &dest, io())
        .await
        .unwrap();

    assert_eq!(outcome, FileCopy::Copied);
    assert_eq!(
        std::fs::read(dest.join("pack.zip.disabled")).unwrap(),
        b"pack"
    );
}

#[tokio::test]
async fn a_file_the_target_has_enabled_or_disabled_is_not_copied_again() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("from");
    let dest = dir.path().join("to");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(&dest).unwrap();
    std::fs::write(src.join("pack.zip"), b"new").unwrap();
    std::fs::write(dest.join("pack.zip.disabled"), b"old").unwrap();

    let outcome = copy_content_entry(&src.join("pack.zip"), &dest, io())
        .await
        .unwrap();

    assert_eq!(outcome, FileCopy::AlreadyThere);
    assert!(!dest.join("pack.zip").exists());
    assert_eq!(
        std::fs::read(dest.join("pack.zip.disabled")).unwrap(),
        b"old"
    );
}

#[tokio::test]
async fn a_shader_folder_is_copied_with_its_contents() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("from");
    let dest = dir.path().join("to");
    std::fs::create_dir_all(src.join("MyShader").join("shaders")).unwrap();
    std::fs::write(src.join("MyShader").join("shaders").join("final.fsh"), b"x").unwrap();

    let outcome = copy_content_entry(&src.join("MyShader"), &dest, io())
        .await
        .unwrap();

    assert_eq!(outcome, FileCopy::Copied);
    assert_eq!(
        std::fs::read(dest.join("MyShader").join("shaders").join("final.fsh")).unwrap(),
        b"x"
    );
}
