use noriskclient_launcher_v3_lib::state::config_state::LauncherConfig;

#[test]
fn closing_quits_the_launcher_unless_someone_chose_the_tray() {
    assert!(!LauncherConfig::default().close_to_tray);
}

#[test]
fn a_config_saved_before_the_tray_option_still_closes_for_real() {
    let mut saved = serde_json::to_value(LauncherConfig::default()).unwrap();
    saved.as_object_mut().unwrap().remove("close_to_tray");

    let loaded: LauncherConfig = serde_json::from_value(saved).unwrap();

    assert!(!loaded.close_to_tray);
}

fn migrated_config(legacy_args: serde_json::Value) -> LauncherConfig {
    let mut saved = serde_json::to_value(LauncherConfig::default()).unwrap();
    saved["global_custom_jvm_args"] = legacy_args;
    let mut config: LauncherConfig = serde_json::from_value(saved).unwrap();
    config.migrate_legacy_jvm_args();
    config
}

#[test]
fn old_global_jvm_args_become_enabled_global_args() {
    let config = migrated_config(serde_json::json!("-XX:+UseZGC"));

    assert!(config.use_global_jvm_args);
    assert_eq!(config.enabled_global_jvm_args(), Some("-XX:+UseZGC"));
    assert!(serde_json::to_value(&config).unwrap().get("global_custom_jvm_args").is_none());
}

#[test]
fn old_empty_global_jvm_args_stay_switched_off() {
    let config = migrated_config(serde_json::Value::Null);

    assert!(!config.use_global_jvm_args);
    assert_eq!(config.enabled_global_jvm_args(), None);
}
