use super::*;
use serde::Deserialize;

#[derive(Deserialize, Debug, PartialEq)]
struct Item {
    id: String,
    count: u64,
}

#[derive(Deserialize, Debug, PartialEq)]
struct Envelope {
    #[serde(default, deserialize_with = "vec")]
    data: Vec<Item>,
    #[serde(default, deserialize_with = "opt_vec")]
    extra: Option<Vec<Item>>,
    #[serde(default, deserialize_with = "opt")]
    logo: Option<Item>,
}

#[test]
fn bad_element_is_skipped_not_fatal() {
    let json = r#"[
        {"id": "a", "count": 1},
        {"id": "b", "count": -5},
        {"id": "c", "count": 3}
    ]"#;
    let items: Vec<Item> = list_from_str(json).expect("envelope must still parse");
    assert_eq!(
        items,
        vec![
            Item { id: "a".into(), count: 1 },
            Item { id: "c".into(), count: 3 },
        ]
    );
}

#[test]
fn overflowing_integer_only_costs_its_own_element() {
    let json = r#"[{"id": "a", "count": 262853717262}, {"id": "b", "count": 1}]"#;
    let items: Vec<Item> = list_from_str(json).unwrap();
    assert_eq!(items.len(), 2);
}

#[test]
fn missing_field_only_costs_its_own_element() {
    let json = r#"[{"id": "a"}, {"id": "b", "count": 1}]"#;
    let items: Vec<Item> = list_from_str(json).unwrap();
    assert_eq!(items, vec![Item { id: "b".into(), count: 1 }]);
}

#[test]
fn malformed_envelope_is_still_an_error() {
    assert!(list_from_str::<Item>("not json").is_err());
    assert!(list_from_str::<Item>(r#"{"id": "a"}"#).is_err());
    assert!(map_from_str::<Item>("[]").is_err());
}

#[test]
fn nested_vec_field_is_lenient() {
    let json = r#"{"data": [{"id": "a", "count": 1}, {"id": "b", "count": -1}]}"#;
    let envelope: Envelope = serde_json::from_str(json).unwrap();
    assert_eq!(envelope.data, vec![Item { id: "a".into(), count: 1 }]);
    assert_eq!(envelope.extra, None);
}

#[test]
fn missing_lenient_vec_field_defaults_to_empty() {
    let envelope: Envelope = serde_json::from_str("{}").unwrap();
    assert!(envelope.data.is_empty());
    assert_eq!(envelope.extra, None);
}

#[test]
fn null_lenient_vec_field_defaults_to_empty() {
    let envelope: Envelope = serde_json::from_str(r#"{"data": null}"#).unwrap();
    assert!(envelope.data.is_empty());
}

#[test]
fn optional_vec_distinguishes_null_from_bad_elements() {
    let null: Envelope = serde_json::from_str(r#"{"extra": null}"#).unwrap();
    assert_eq!(null.extra, None);

    let bad: Envelope = serde_json::from_str(r#"{"extra": [{"id": "a", "count": -1}]}"#).unwrap();
    assert_eq!(bad.extra, Some(Vec::new()));
}

#[test]
fn bad_optional_field_becomes_none_and_keeps_its_owner() {
    let json = r#"{"data": [], "logo": {"id": "a", "count": -1}}"#;
    let envelope: Envelope = serde_json::from_str(json).unwrap();
    assert_eq!(envelope.logo, None);

    let good: Envelope = serde_json::from_str(r#"{"logo": {"id": "a", "count": 1}}"#).unwrap();
    assert_eq!(good.logo, Some(Item { id: "a".into(), count: 1 }));
}

#[test]
fn map_skips_bad_values_and_keeps_good_keys() {
    let json = r#"{"h1": {"id": "a", "count": 1}, "h2": {"id": "b", "count": -1}}"#;
    let map = map_from_str::<Item>(json).unwrap();
    assert_eq!(map.len(), 1);
    assert_eq!(map.get("h1"), Some(&Item { id: "a".into(), count: 1 }));
}
