use noriskclient_launcher_v3_lib::support::types::*;

#[test]
fn parses_backend_request_and_tolerates_unknown_types() {
    let json = r#"{
        "requestId": "r1", "ticketId": 42, "ticketNumber": 1165, "category": "CRASH",
        "requestedBy": { "displayName": "Staffer", "discordId": "123" },
        "items": [ { "type": "MC_LATEST_LOG" }, { "type": "SOMETHING_NEW", "params": { "x": 1 } } ],
        "createdAt": "2026-10-13T10:00:00Z", "expiresAt": 1760400000000,
        "maxFileBytes": 8388608, "maxTotalBytes": 26214400, "maxFiles": 6
    }"#;
    let parsed: RemoteSupportRequest = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.ticket_id, "42");
    assert_eq!(parsed.items[1].item_type, "SOMETHING_NEW");

    let view = SupportRequestInfo {
        code: "ABCDEFGH".into(),
        request: parsed,
        account: AccountRef {
            id: "a".into(),
            ign: "Steve".into(),
        },
        capabilities: vec![],
    };
    let out = serde_json::to_value(&view).unwrap();
    assert_eq!(out["ticketNumber"], 1165);
    assert_eq!(out["requestedBy"]["displayName"], "Staffer");
    assert!(out["requestedBy"].get("discordId").is_none());
    assert_eq!(out["account"]["ign"], "Steve");
    assert_eq!(serde_json::to_value(ItemStatus::Unsupported).unwrap(), "UNSUPPORTED");
    assert_eq!(serde_json::to_value(ItemCategory::Collect).unwrap(), "COLLECT");
}
