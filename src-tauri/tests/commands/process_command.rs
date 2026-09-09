use noriskclient_launcher_v3_lib::commands::process_command::*;

#[test]
fn a_session_id_that_could_escape_the_log_folder_is_rejected() {
    assert!(validate_log_session_id("valid-session-123").is_ok());
    assert!(validate_log_session_id("abc_def-123").is_ok());

    assert!(validate_log_session_id("").is_err());
    assert!(validate_log_session_id("session/id").is_err());
    assert!(validate_log_session_id("session\\id").is_err());
    assert!(validate_log_session_id("session..id").is_err());
}

#[test]
fn a_log_read_never_exceeds_the_cursor_budget() {
    assert_eq!(clamp_log_read_len(None), MAX_LOG_CURSOR_BYTES);
    assert_eq!(clamp_log_read_len(Some(100)), 100);
    assert_eq!(clamp_log_read_len(Some(0)), 1);
    assert_eq!(
        clamp_log_read_len(Some(MAX_LOG_CURSOR_BYTES + 100)),
        MAX_LOG_CURSOR_BYTES
    );
}
