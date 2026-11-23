use noriskclient_launcher_v3_lib::integrations::norisk_packs::LoaderStrategy;
use serde_json::Value;

#[test]
fn loader_strategy_keeps_its_config_spelling() {
    for spelling in ["exact", "latest_compatible", "min_compatible"] {
        let parsed: LoaderStrategy = serde_json::from_str(&format!("\"{spelling}\""))
            .unwrap_or_else(|e| panic!("pack configs still say {spelling}: {e}"));
        assert_eq!(
            serde_json::to_value(&parsed).unwrap(),
            Value::String(spelling.to_string())
        );
    }
}

#[test]
fn pack_jvm_rules_come_after_the_rules_of_their_parents() {
    let config: noriskclient_launcher_v3_lib::integrations::norisk_packs::NoriskModpacksConfig =
        serde_json::from_value(serde_json::json!({
            "packs": {
                "base": { "displayName": "Base", "description": "", "jvm": [{ "id": "base", "args": ["-XX:+UseStringDeduplication"] }] },
                "plain": { "displayName": "Plain", "description": "" },
                "child": {
                    "displayName": "Child",
                    "description": "",
                    "inheritsFrom": ["base", "plain"],
                    "jvm": [{ "id": "child", "args": ["-XX:+UseZGC"] }]
                }
            }
        }))
        .unwrap();

    let ids = |pack: &str| -> Vec<String> {
        config
            .get_resolved_pack_definition(pack)
            .unwrap()
            .jvm
            .map(|rules| rules.as_array().unwrap().iter().map(|rule| rule["id"].as_str().unwrap().to_string()).collect())
            .unwrap_or_default()
    };

    assert_eq!(ids("child"), vec!["base", "child"]);
    assert_eq!(ids("base"), vec!["base"]);
    assert!(ids("plain").is_empty());
}
