use super::merge_settings;
use crate::minecraft::dto::cosmetic_outfit::{CosmeticSettings, Vector3f};
use serde_json::{json, Value};

fn meta() -> Value {
    json!({
        "type": "HAT",
        "defaultSettings": {
            "scale": 1.0,
            "offset": { "x": 0.0, "y": 0.25, "z": 0.0 },
            "color": null
        },
        "features": [
            { "range": { "start": -0.5, "endInclusive": 1.5 }, "type": "Y_AXIS" },
            { "range": { "start": 0.0, "endInclusive": 1.0 }, "type": "SCALABLE" },
            { "range": { "start": -1.0, "endInclusive": 1.0 }, "type": "Y_AXIS", "additionalType": "Z_AXIS" }
        ]
    })
}

fn settings(scale: Option<f64>, offset: Option<(f64, f64, f64)>) -> CosmeticSettings {
    CosmeticSettings {
        scale,
        offset: offset.map(|(x, y, z)| Vector3f { x, y, z }),
        ..Default::default()
    }
}

fn resolved(meta: &Value) -> (f64, [f64; 3]) {
    let ds = &meta["defaultSettings"];
    (
        ds["scale"].as_f64().unwrap(),
        [
            ds["offset"]["x"].as_f64().unwrap(),
            ds["offset"]["y"].as_f64().unwrap(),
            ds["offset"]["z"].as_f64().unwrap(),
        ],
    )
}

#[test]
fn without_player_settings_meta_is_untouched() {
    let before = meta();
    assert_eq!(merge_settings(before.clone(), None), before);
}

#[test]
fn deltas_inside_range_are_added_to_defaults() {
    let merged = merge_settings(meta(), Some(&settings(Some(0.5), Some((0.0, 1.0, -0.5)))));
    assert_eq!(resolved(&merged), (1.5, [0.0, 1.25, -0.5]));
}

#[test]
fn values_outside_range_are_ignored_per_axis() {
    let merged = merge_settings(meta(), Some(&settings(Some(5.0), Some((0.0, 2.0, 0.0)))));
    assert_eq!(resolved(&merged), (1.0, [0.0, 0.25, 0.0]));
}

#[test]
fn axis_without_feature_is_ignored() {
    let merged = merge_settings(meta(), Some(&settings(None, Some((0.7, 0.0, 0.0)))));
    assert_eq!(resolved(&merged), (1.0, [0.0, 0.25, 0.0]));
}

#[test]
fn missing_player_values_count_as_zero() {
    let merged = merge_settings(meta(), Some(&CosmeticSettings::default()));
    assert_eq!(resolved(&merged), (1.0, [0.0, 0.25, 0.0]));
}

#[test]
fn unknown_feature_slots_are_skipped() {
    let mut meta = meta();
    meta["features"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "range": { "start": 0.0, "endInclusive": 9.0 }, "type": "ROTATION" }));
    let merged = merge_settings(meta, Some(&settings(Some(0.5), None)));
    assert_eq!(resolved(&merged), (1.5, [0.0, 0.25, 0.0]));
}

#[test]
fn player_color_replaces_default_color() {
    let mut player = settings(None, None);
    player.color = Some(json!({ "red": 1.0, "green": 0.5, "blue": 0.0 }));
    let merged = merge_settings(meta(), Some(&player));
    assert_eq!(merged["defaultSettings"]["color"]["green"], json!(0.5));
}
