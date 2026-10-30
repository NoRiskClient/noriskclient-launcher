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
