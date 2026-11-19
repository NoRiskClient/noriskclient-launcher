fn main() {
    println!("cargo:rerun-if-env-changed=NRC_CAPTURE_RUNTIME_SHA256");
    println!("cargo:rerun-if-env-changed=NRC_CAPTURE_RUNTIME_URL");
    embed_test_manifest();
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "ads",
            tauri_build::InlinedPlugin::new()
                .commands(&[
                    "ad_clicked",
                    "open_ad_link",
                    "ad_consent_mode",
                    "ad_privacy",
                ])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}

fn embed_test_manifest() {
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return;
    }
    let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("windows-test-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
}
