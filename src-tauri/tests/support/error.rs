use noriskclient_launcher_v3_lib::error::AppError;
use noriskclient_launcher_v3_lib::support::error::*;

#[test]
fn maps_backend_error_bodies() {
    let gone = r#"{"translatableKey":"message.ticket.support_request.error.expired","args":[]}"#;
    assert_eq!(
        SupportError::from_response(410, gone, None).to_string(),
        "support:gone: message.ticket.support_request.error.expired"
    );
    let not_found = r#"{"translatableKey":"message.ticket.support_request.error.not_found","args":[]}"#;
    assert_eq!(
        SupportError::from_response(404, not_found, None).kind,
        SupportErrorKind::NotFound
    );

    let busy = r#"{"translatableKey":"message.ticket.support_request.error.busy","args":[]}"#;
    assert_eq!(
        SupportError::from_response(503, busy, Some(30)).to_string(),
        "support:busy: 30"
    );
    assert_eq!(
        SupportError::from_response(503, busy, None).to_string(),
        "support:busy"
    );
    let storage = r#"{"translatableKey":"message.ticket.support_request.error.storage_unavailable","args":[]}"#;
    assert_eq!(
        SupportError::from_response(503, storage, None).to_string(),
        "support:unknown: storage_unavailable"
    );
}

#[test]
fn a_backend_without_support_requests_is_not_reported_as_a_missing_link() {
    assert_eq!(
        SupportError::from_response(404, "", None).kind,
        SupportErrorKind::Unknown
    );
    assert_eq!(
        SupportError::from_response(404, "<html>Not Found</html>", None).kind,
        SupportErrorKind::Unknown
    );
}

#[test]
fn an_upload_the_backend_gave_up_on_asks_the_player_to_try_again() {
    let timeout = r#"{"translatableKey":"message.ticket.support_request.error.upload_timeout","args":[]}"#;
    assert_eq!(
        SupportError::from_response(408, timeout, None).kind,
        SupportErrorKind::Offline
    );
}

#[test]
fn message_starts_with_stable_key() {
    assert_eq!(
        SupportError::new(SupportErrorKind::Gone).to_string(),
        "support:gone"
    );
    assert_eq!(
        SupportError::from_status(404, None).to_string(),
        "support:not_found: HTTP 404"
    );
    assert_eq!(
        SupportError::from_status(429, Some("slow down".into())).to_string(),
        "support:rate_limited: slow down"
    );
}

#[test]
fn a_refused_request_is_not_mistaken_for_a_logout() {
    let expired = r#"{"translatableKey":"nrc.generic.error.invalid_or_expired_token","args":[]}"#;
    assert_eq!(SupportError::from_response(403, expired, None).kind, SupportErrorKind::NotLoggedIn);
    assert_eq!(SupportError::from_response(403, "", None).kind, SupportErrorKind::NotLoggedIn);
}

fn failed_download(status: u16, key: &str) -> SupportErrorKind {
    SupportError::from(AppError::ApiError {
        status,
        translatable_key: key.to_string(),
        args: vec![],
    })
    .kind
}

#[test]
fn a_download_refused_for_missing_staff_rights_says_forbidden() {
    assert_eq!(failed_download(403, "message.ticket.error.not_permitted"), SupportErrorKind::Forbidden);
}

#[test]
fn a_download_of_a_missing_or_expired_copy_says_so() {
    assert_eq!(failed_download(404, "message.ticket.error.not_found"), SupportErrorKind::NotFound);
    assert_eq!(failed_download(410, "message.ticket.error.expired"), SupportErrorKind::Gone);
    let plain = SupportError::from(AppError::HttpStatus { status: 404, message: "gone".into() });
    assert_eq!(plain.kind, SupportErrorKind::NotFound);
}
