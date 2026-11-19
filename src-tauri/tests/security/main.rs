use noriskclient_launcher_v3_lib::ipc_guard::allows;

#[test]
fn remote_sign_in_windows_cannot_call_any_launcher_command() {
    for label in ["signin", "discord-signin", "github-signin"] {
        assert!(!allows(label), "{label} must be refused");
    }
}

#[test]
fn the_main_window_can_call_launcher_commands() {
    assert!(allows("main"));
}

#[test]
fn other_launcher_windows_keep_their_access() {
    for label in [
        "updater",
        "applixir_window",
        "clip_editor",
        "minecraft-log-window",
        "some-new-window",
    ] {
        assert!(allows(label), "{label} must stay allowed");
    }
}
