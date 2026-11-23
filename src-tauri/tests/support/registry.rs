use noriskclient_launcher_v3_lib::support::registry::*;

#[test]
fn offers_every_contract_type_and_ignores_unknown_ones() {
    let caps = capabilities();
    for t in [
        "MC_LATEST_LOG",
        "MC_DEBUG_LOG",
        "MC_LATEST_CRASH",
        "JVM_CRASH",
        "LAUNCHER_LOG",
        "LAST_SESSION_LOG",
        "MOD_LIST",
        "PROFILE_SUMMARY",
        "SYSTEM_INFO",
        "MC_SETTINGS",
        "NRC_PROFILE",
        "UPDATE_LOADER",
        "SWITCH_PACK",
    ] {
        assert!(caps.iter().any(|c| c == t), "missing {}", t);
    }
    assert!(REGISTRY.get("SOMETHING_NEW").is_none());
}
