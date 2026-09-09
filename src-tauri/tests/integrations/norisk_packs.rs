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
