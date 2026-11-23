mod logs;
mod mc_settings;
mod nrc_profile;
mod profile_summary;
mod update_loader;

use crate::test_ctx;
use noriskclient_launcher_v3_lib::support::handler::PreparedItem;
use noriskclient_launcher_v3_lib::support::handlers::redact_json;
use noriskclient_launcher_v3_lib::support::registry::REGISTRY;
use noriskclient_launcher_v3_lib::support::types::ItemParams;
use serde_json::json;
use std::path::Path;

pub fn prepare_item(type_id: &str, instance: &Path, file_byte_budget: u64) -> PreparedItem {
    let ctx = test_ctx(instance, file_byte_budget);
    let handler = REGISTRY.get(type_id).unwrap();
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(handler.prepare(&ctx, &ItemParams::new()))
}

pub fn sent_file(item: &PreparedItem) -> String {
    item.file.as_ref().map(|f| f.to_string()).unwrap_or_default()
}

#[test]
fn redact_json_caps_strings_and_drops_empty_values() {
    let out = redact_json(
        json!({ "a": "x".repeat(300), "b": "", "c": null, "d": 5, "e": [ { "f": " " } ] }),
        128,
    );
    assert_eq!(out["a"].as_str().unwrap().chars().count(), 128);
    assert!(out.get("b").is_none());
    assert!(out.get("c").is_none());
    assert_eq!(out["d"], 5);
    assert_eq!(out["e"][0], json!({}));
}
