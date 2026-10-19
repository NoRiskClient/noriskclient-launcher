use noriskclient_launcher_v3_lib::utils::deep_link_utils::PendingDeepLinks;

#[test]
fn queues_until_first_take_then_stops_queueing() {
    let pending = PendingDeepLinks::default();
    assert!(pending.queue_if_not_ready("a", serde_json::json!({"code": "X"})));
    assert!(pending.queue_if_not_ready("b", serde_json::json!(1)));

    let drained = pending.take();
    assert_eq!(drained.len(), 2);
    assert_eq!(drained[0].event, "a");
    assert_eq!(drained[1].event, "b");

    assert!(!pending.queue_if_not_ready("c", serde_json::json!(null)));
    assert!(pending.take().is_empty());
}

#[test]
fn keeps_only_newest_entry_per_event_type() {
    let pending = PendingDeepLinks::default();
    pending.queue_if_not_ready("support", serde_json::json!({"code": "OLD"}));
    pending.queue_if_not_ready("auth", serde_json::json!(1));
    pending.queue_if_not_ready("support", serde_json::json!({"code": "NEW"}));
    let drained = pending.take();
    assert_eq!(drained.len(), 2);
    assert_eq!(drained[0].event, "auth");
    assert_eq!(drained[1].payload["code"], "NEW");
}
