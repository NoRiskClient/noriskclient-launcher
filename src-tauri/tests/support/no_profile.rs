use crate::test_ctx_without_profile;
use noriskclient_launcher_v3_lib::support::handler::NO_PROFILE;
use noriskclient_launcher_v3_lib::support::registry::REGISTRY;
use noriskclient_launcher_v3_lib::support::service::prepare_item;
use noriskclient_launcher_v3_lib::support::types::ItemParams;

async fn prepare_without_profile(item_type: &str) -> noriskclient_launcher_v3_lib::support::handler::PreparedItem {
    let handler = REGISTRY.get(item_type).unwrap();
    prepare_item(handler, &test_ctx_without_profile(1024 * 1024), &ItemParams::default()).await
}

#[test]
fn only_temp_profile_system_info_and_launcher_log_work_without_a_profile() {
    for free in ["START_TEMP_PROFILE", "SYSTEM_INFO", "LAUNCHER_LOG"] {
        assert!(!REGISTRY.get(free).unwrap().needs_profile(), "{}", free);
    }
    for bound in [
        "MOD_LIST",
        "PROFILE_SUMMARY",
        "UPDATE_LOADER",
        "SWITCH_PACK",
        "MC_LATEST_LOG",
        "MC_DEBUG_LOG",
        "MC_LATEST_CRASH",
        "JVM_CRASH",
        "LAST_SESSION_LOG",
        "MC_SETTINGS",
        "NRC_PROFILE",
    ] {
        assert!(REGISTRY.get(bound).unwrap().needs_profile(), "{}", bound);
    }
}

#[tokio::test]
async fn system_info_is_collected_without_a_profile() {
    let item = prepare_without_profile("SYSTEM_INFO").await;
    assert!(item.available);
    assert!(item.error.is_none());
}

#[tokio::test]
async fn profile_bound_items_report_no_profile_instead_of_failing() {
    for bound in ["MOD_LIST", "PROFILE_SUMMARY", "UPDATE_LOADER", "SWITCH_PACK", "MC_LATEST_LOG"] {
        let item = prepare_without_profile(bound).await;
        assert!(!item.available, "{}", bound);
        assert!(item.error.is_none(), "{}", bound);
        assert!(item.summary.as_deref().unwrap_or_default().starts_with(NO_PROFILE), "{}", bound);
    }
}
