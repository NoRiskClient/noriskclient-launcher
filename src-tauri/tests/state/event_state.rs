use noriskclient_launcher_v3_lib::state::event_state::*;

#[test]
fn first_call_always_emits() {
    let t = ProgressThrottle::new(100);
    assert!(t.should_emit_at(1000));
}

#[test]
fn suppresses_within_interval() {
    let t = ProgressThrottle::new(100);
    assert!(t.should_emit_at(1000));
    assert!(!t.should_emit_at(1050));
    assert!(!t.should_emit_at(1099));
}

#[test]
fn emits_again_after_interval() {
    let t = ProgressThrottle::new(100);
    assert!(t.should_emit_at(1000));
    assert!(t.should_emit_at(1100));
    assert!(!t.should_emit_at(1150));
    assert!(t.should_emit_at(1200));
}

#[test]
fn concurrent_completions_only_one_passes() {
    let t = ProgressThrottle::new(100);
    assert!(t.should_emit_at(1000));
    for _ in 0..1000 {
        assert!(!t.should_emit_at(1000));
    }
}
