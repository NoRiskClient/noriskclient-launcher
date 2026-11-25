use fastnbt::Value;
use noriskclient_launcher_v3_lib::utils::server_list::{apply_server_list_edit, ServerListEdit, ServerListError, ServerRef};
use std::collections::HashMap;

fn entry(name: &str, ip: &str, extra: &[(&str, Value)]) -> Value {
    let mut map = HashMap::new();
    map.insert("name".to_string(), Value::String(name.to_string()));
    map.insert("ip".to_string(), Value::String(ip.to_string()));
    for (key, value) in extra {
        map.insert(key.to_string(), value.clone());
    }
    Value::Compound(map)
}

fn file(entries: Vec<Value>) -> Vec<u8> {
    let mut root = HashMap::new();
    root.insert("servers".to_string(), Value::List(entries));
    fastnbt::to_bytes(&Value::Compound(root)).unwrap()
}

fn servers(bytes: &[u8]) -> Vec<HashMap<String, Value>> {
    let Value::Compound(root) = fastnbt::from_bytes::<Value>(bytes).unwrap() else { panic!("root") };
    let Some(Value::List(list)) = root.get("servers") else { return Vec::new() };
    list.iter()
        .map(|v| match v {
            Value::Compound(map) => map.clone(),
            _ => panic!("entry"),
        })
        .collect()
}

fn text(map: &HashMap<String, Value>, key: &str) -> Option<String> {
    match map.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

fn add(name: &str, address: &str) -> ServerListEdit {
    ServerListEdit::Add { name: name.into(), address: address.into() }
}

#[test]
fn adding_a_server_without_a_file_creates_the_list() {
    let out = apply_server_list_edit(None, &add("Hypixel", "mc.hypixel.net")).unwrap();
    let list = servers(&out);
    assert_eq!(list.len(), 1);
    assert_eq!(text(&list[0], "name").as_deref(), Some("Hypixel"));
    assert_eq!(text(&list[0], "ip").as_deref(), Some("mc.hypixel.net"));
}

#[test]
fn adding_a_server_appends_it_and_keeps_the_others_untouched() {
    let before = file(vec![entry("Old", "old.net", &[("icon", Value::String("AAAA".into())), ("hidden", Value::Byte(0))])]);
    let out = apply_server_list_edit(Some(&before), &add("New", "new.net")).unwrap();
    let list = servers(&out);
    assert_eq!(list.len(), 2);
    assert_eq!(text(&list[0], "icon").as_deref(), Some("AAAA"));
    assert_eq!(list[0].get("hidden"), Some(&Value::Byte(0)));
    assert_eq!(text(&list[1], "ip").as_deref(), Some("new.net"));
}

#[test]
fn a_blank_name_falls_back_to_the_address_and_input_is_trimmed() {
    let out = apply_server_list_edit(None, &add("  ", "  play.example.com  ")).unwrap();
    let list = servers(&out);
    assert_eq!(text(&list[0], "name").as_deref(), Some("play.example.com"));
    assert_eq!(text(&list[0], "ip").as_deref(), Some("play.example.com"));
}

#[test]
fn a_blank_address_is_rejected() {
    assert!(matches!(apply_server_list_edit(None, &add("Name", "   ")), Err(ServerListError::Invalid)));
}

#[test]
fn updating_keeps_unknown_fields_and_drops_the_icon_when_the_address_changes() {
    let before = file(vec![entry("A", "a.net", &[("icon", Value::String("AAAA".into())), ("acceptTextures", Value::Byte(1))])]);
    let same = apply_server_list_edit(
        Some(&before),
        &ServerListEdit::Update { index: 0, expected_address: "a.net".into(), name: "Renamed".into(), address: "a.net".into() },
    )
    .unwrap();
    let list = servers(&same);
    assert_eq!(text(&list[0], "name").as_deref(), Some("Renamed"));
    assert_eq!(text(&list[0], "icon").as_deref(), Some("AAAA"));
    assert_eq!(list[0].get("acceptTextures"), Some(&Value::Byte(1)));

    let moved = apply_server_list_edit(
        Some(&before),
        &ServerListEdit::Update { index: 0, expected_address: "a.net".into(), name: "A".into(), address: "b.net".into() },
    )
    .unwrap();
    let list = servers(&moved);
    assert_eq!(text(&list[0], "ip").as_deref(), Some("b.net"));
    assert!(list[0].get("icon").is_none());
    assert_eq!(list[0].get("acceptTextures"), Some(&Value::Byte(1)));
}

#[test]
fn removing_drops_only_that_entry() {
    let before = file(vec![entry("A", "a.net", &[]), entry("B", "b.net", &[]), entry("C", "c.net", &[])]);
    let out = apply_server_list_edit(Some(&before), &ServerListEdit::Remove { index: 1, expected_address: "b.net".into() }).unwrap();
    let names: Vec<_> = servers(&out).iter().map(|m| text(m, "name").unwrap()).collect();
    assert_eq!(names, vec!["A", "C"]);
}

#[test]
fn an_edit_against_a_changed_list_is_refused() {
    let before = file(vec![entry("A", "a.net", &[])]);
    let wrong_address = ServerListEdit::Remove { index: 0, expected_address: "other.net".into() };
    let out_of_range = ServerListEdit::Update { index: 3, expected_address: "a.net".into(), name: "X".into(), address: "x.net".into() };
    assert!(matches!(apply_server_list_edit(Some(&before), &wrong_address), Err(ServerListError::Stale)));
    assert!(matches!(apply_server_list_edit(Some(&before), &out_of_range), Err(ServerListError::Stale)));
}

#[test]
fn an_unreadable_file_is_never_overwritten() {
    assert!(matches!(apply_server_list_edit(Some(b"not nbt"), &add("A", "a.net")), Err(ServerListError::Unreadable)));
}


fn entry_ref(index: usize, address: &str) -> ServerRef {
    ServerRef { index, expected_address: address.into() }
}

#[test]
fn removing_several_servers_drops_exactly_those_in_one_go() {
    let before = file(vec![entry("A", "a.net", &[]), entry("B", "b.net", &[]), entry("C", "c.net", &[]), entry("D", "d.net", &[])]);
    let out = apply_server_list_edit(
        Some(&before),
        &ServerListEdit::RemoveMany { entries: vec![entry_ref(0, "a.net"), entry_ref(2, "c.net")] },
    )
    .unwrap();
    let names: Vec<_> = servers(&out).iter().map(|m| text(m, "name").unwrap()).collect();
    assert_eq!(names, vec!["B", "D"]);
}

#[test]
fn removing_several_servers_changes_nothing_when_one_no_longer_matches() {
    let before = file(vec![entry("A", "a.net", &[]), entry("B", "b.net", &[])]);
    let edit = ServerListEdit::RemoveMany { entries: vec![entry_ref(0, "a.net"), entry_ref(1, "moved.net")] };
    assert!(matches!(apply_server_list_edit(Some(&before), &edit), Err(ServerListError::Stale)));
}

#[test]
fn removing_the_same_server_twice_in_one_batch_is_refused() {
    let before = file(vec![entry("A", "a.net", &[]), entry("B", "b.net", &[])]);
    let edit = ServerListEdit::RemoveMany { entries: vec![entry_ref(1, "b.net"), entry_ref(1, "b.net")] };
    assert!(matches!(apply_server_list_edit(Some(&before), &edit), Err(ServerListError::Stale)));
}
