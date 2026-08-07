use super::*;

#[test]
fn flattens_managed_mod_dirs_into_overrides_mods() {
    assert_eq!(
        override_zip_path("mods/nrc-1.21.1-fabric/sodium-0.6.jar").as_deref(),
        Some("overrides/mods/sodium-0.6.jar")
    );
    assert_eq!(
        override_zip_path("mods/nrc-1.21.1-neoforge-ab12/jei.jar").as_deref(),
        Some("overrides/mods/jei.jar")
    );
    assert_eq!(
        override_zip_path("custom_mods/my-mod.jar").as_deref(),
        Some("overrides/mods/my-mod.jar")
    );
}

#[test]
fn keeps_regular_paths_verbatim() {
    assert_eq!(
        override_zip_path("mods/local-mod.jar").as_deref(),
        Some("overrides/mods/local-mod.jar")
    );
    assert_eq!(
        override_zip_path("config/sodium-options.json").as_deref(),
        Some("overrides/config/sodium-options.json")
    );
    assert_eq!(
        override_zip_path("options.txt").as_deref(),
        Some("overrides/options.txt")
    );
    assert_eq!(
        override_zip_path("saves/world/level.dat").as_deref(),
        Some("overrides/saves/world/level.dat")
    );
}

#[test]
fn drops_launcher_internal_and_runtime_junk() {
    assert_eq!(override_zip_path("profile.json"), None);
    assert_eq!(override_zip_path("logs/latest.log"), None);
    assert_eq!(override_zip_path("crash-reports/crash-2026.txt"), None);
    assert_eq!(override_zip_path(".fabric/remappedJars/a.jar"), None);
    assert_eq!(override_zip_path(".mixin.out/class.json"), None);
    assert_eq!(override_zip_path("config/.DS_Store"), None);
}
