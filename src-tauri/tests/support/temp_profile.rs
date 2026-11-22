use noriskclient_launcher_v3_lib::minecraft::temp_profile::TempLaunchArgs;
use noriskclient_launcher_v3_lib::state::event_state::{
    publish_process_exit, MinecraftProcessExitedPayload,
};
use noriskclient_launcher_v3_lib::support::follow_up::{
    exit_kind, is_watched, take_report, watch, TempProfileExit,
};
use noriskclient_launcher_v3_lib::support::handler::SessionRef;
use noriskclient_launcher_v3_lib::support::handlers::temp_profile::{
    parse_spec, temp_profile_for, TempSpec,
};
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

fn spec(mods_from: Option<&str>) -> TempSpec {
    TempSpec {
        args: TempLaunchArgs {
            game_version: "1.21.4".into(),
            loader: "fabric".into(),
            loader_version: None,
            pack: Some("norisk-prod".into()),
            name: None,
            quick_play_singleplayer: None,
            quick_play_multiplayer: None,
            local_mods: Vec::new(),
            account: None,
            jvm_args: Vec::new(),
        },
        mods_from: mods_from.map(str::to_string),
    }
}

#[test]
fn a_support_test_profile_has_its_spec_and_no_mods_by_default() {
    let profile = temp_profile_for(&spec(None), None).unwrap();
    assert_eq!(profile.selected_norisk_pack_id.as_deref(), Some("norisk-prod"));
    assert!(profile.mods.is_empty());
}

#[test]
fn test_profile_params_follow_the_contract() {
    let ok = json!({ "minecraft": "1.21.4", "loader": "neoforge", "loaderVersion": "21.4.1", "modsFrom": "Mein Profil (2)" });
    assert!(parse_spec(ok.as_object().unwrap()).is_ok());
    for bad in [
        json!({ "minecraft": "1.21.4" }),
        json!({ "minecraft": "1.21.4", "loader": "liteloader" }),
        json!({ "minecraft": "1.21.4", "loader": "fabric", "jvmArgs": "-Xmx99G" }),
        json!({ "minecraft": "../1", "loader": "fabric" }),
        json!({ "minecraft": "1.21.4", "loader": "fabric", "pack": "Bad Pack" }),
    ] {
        assert!(parse_spec(bad.as_object().unwrap()).is_err(), "{}", bad);
    }
}

#[test]
fn how_the_test_game_ended_is_reported_plainly() {
    assert_eq!(exit_kind(Some(0), false), TempProfileExit::Clean);
    assert_eq!(exit_kind(Some(-1), false), TempProfileExit::Crashed);
    assert_eq!(exit_kind(Some(1), true), TempProfileExit::Killed);
    assert_eq!(exit_kind(None, false), TempProfileExit::Killed);
}

fn exit_of(profile_id: Uuid, exit_code: Option<i32>) -> MinecraftProcessExitedPayload {
    MinecraftProcessExitedPayload {
        profile_id,
        process_id: Uuid::new_v4(),
        exit_code,
        success: exit_code == Some(0),
        was_intentionally_stopped: false,
        process_metadata: None,
        crash_report_content: None,
    }
}

fn session() -> SessionRef {
    SessionRef {
        code: "ABC123".into(),
        account_id: Uuid::new_v4(),
        is_experimental: false,
    }
}

#[tokio::test]
async fn a_watched_test_profile_is_reported_once_when_its_process_exits() {
    let manual = Uuid::new_v4();
    assert!(take_report(&exit_of(manual, Some(1))).is_none());
    watch(manual, session());
    let (_, report) = take_report(&exit_of(manual, Some(1))).unwrap();
    assert_eq!(report.exit, TempProfileExit::Crashed);
    assert!(take_report(&exit_of(manual, Some(1))).is_none());

    let via_event = Uuid::new_v4();
    watch(via_event, session());
    publish_process_exit(&exit_of(via_event, Some(0)));
    for _ in 0..50 {
        if !is_watched(via_event) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("exit event was not picked up");
}
