use noriskclient_launcher_v3_lib::integrations::mrpack::is_manifest_mod_path;

#[test]
fn only_jars_in_mods_are_managed_mods() {
    assert!(is_manifest_mod_path("mods/sodium.jar"));
    assert!(is_manifest_mod_path("./mods\\Sodium.JAR"));
    assert!(is_manifest_mod_path("mods/sodium.jar.disabled"));
    assert!(!is_manifest_mod_path("mods/voxy-0.2.9-alpha-1.21.11.jar.source"));
    assert!(!is_manifest_mod_path("mods/readme.txt"));
    assert!(!is_manifest_mod_path("resourcepacks/pack.jar"));
}
