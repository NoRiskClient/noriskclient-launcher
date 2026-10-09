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

#[test]
fn a_viewer_opening_a_long_log_starts_near_its_end() {
    assert_eq!(log_read_start(0, 1_000, true), 0);
    assert_eq!(log_read_start(0, LOG_TAIL_BYTES + 5_000, true), 5_000);
    assert_eq!(log_read_start(700, LOG_TAIL_BYTES + 5_000, true), 700);
}

#[test]
fn a_viewer_reads_a_restarted_log_from_near_its_end_again() {
    assert_eq!(log_read_start(9_000, 1_000, true), 0);
    assert_eq!(log_read_start(u64::MAX, LOG_TAIL_BYTES + 5_000, true), 5_000);
}

#[test]
fn a_crash_upload_still_reads_the_log_from_its_start() {
    assert_eq!(log_read_start(0, LOG_TAIL_BYTES + 5_000, false), 0);
    assert_eq!(log_read_start(u64::MAX, LOG_TAIL_BYTES + 5_000, false), 0);
}

#[test]
fn a_line_the_game_is_still_writing_waits_for_the_next_read() {
    assert_eq!(line_aligned(b"first\nsecond\nthi", false, false), 0..13);
    assert_eq!(line_aligned(b"half a line", false, false), 0..0);
}

#[test]
fn a_read_that_begins_inside_a_line_drops_that_fragment() {
    assert_eq!(line_aligned(b"ment\nwhole\n", true, false), 5..11);
    assert_eq!(line_aligned(b"no newline yet", true, false), 0..0);
}

#[test]
fn a_single_line_longer_than_the_budget_is_still_shown() {
    assert_eq!(line_aligned(b"endless spam", false, true), 0..12);
}

#[test]
fn a_fragment_longer_than_the_budget_is_skipped_instead_of_stalling() {
    assert_eq!(line_aligned(b"endless fragment", true, true), 16..16);
}
