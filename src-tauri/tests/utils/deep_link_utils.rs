use noriskclient_launcher_v3_lib::utils::deep_link_utils::{is_deep_link_launch, PendingDeepLinks};

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

#[test]
fn a_second_start_by_a_deep_link_is_recognised() {
    let exe = r"C:\launcher\noriskclient-launcher-v3.exe".to_string();
    assert!(is_deep_link_launch(&[exe.clone(), "norisk://support/request?code=ABC".into()]));
    assert!(!is_deep_link_launch(&[exe.clone(), "launch".into(), "--profile".into(), "x".into()]));
    assert!(!is_deep_link_launch(&[exe.clone(), "https://norisk.gg".into()]));
    assert!(!is_deep_link_launch(&[exe]));
}
