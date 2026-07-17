use super::*;
use reqwest::StatusCode;

fn deserialize_failure(status: StatusCode) -> AppError {
    let source = serde_json::from_str::<serde_json::Value>("<html>login</html>").unwrap_err();
    AppError::MinecraftAuthenticationError(MinecraftAuthenticationError::DeserializeResponse {
        step: MinecraftAuthStep::RefreshOAuthToken,
        raw: "<html>login</html>".to_string(),
        source,
        status_code: status,
    })
}

#[test]
fn treats_captive_portal_body_as_unreachable() {
    assert!(unreachable_reason(&deserialize_failure(StatusCode::OK)).is_some());
}

#[test]
fn treats_rate_limit_and_server_errors_as_unreachable() {
    assert!(unreachable_reason(&deserialize_failure(StatusCode::TOO_MANY_REQUESTS)).is_some());
    assert!(unreachable_reason(&deserialize_failure(StatusCode::INTERNAL_SERVER_ERROR)).is_some());
    assert!(unreachable_reason(&deserialize_failure(StatusCode::BAD_GATEWAY)).is_some());
}

#[test]
fn does_not_mask_real_auth_rejections() {
    assert!(unreachable_reason(&deserialize_failure(StatusCode::BAD_REQUEST)).is_none());
    assert!(unreachable_reason(&deserialize_failure(StatusCode::UNAUTHORIZED)).is_none());
    assert!(unreachable_reason(&deserialize_failure(StatusCode::FORBIDDEN)).is_none());
}

#[test]
fn ignores_unrelated_errors() {
    assert!(unreachable_reason(&AppError::NoCredentialsError).is_none());
    assert!(unreachable_reason(&AppError::Other("boom".to_string())).is_none());
}

// api_utils builds RequestError from any non-2xx status, so it carries server
// rejections (401/403) as well as transport failures. Treating it as unreachable
// would strand the user on dead credentials instead of prompting a re-login.
#[test]
fn does_not_treat_request_error_as_unreachable() {
    assert!(unreachable_reason(&AppError::RequestError(
        "Request failed with status 401 Unauthorized".to_string()
    ))
    .is_none());
}
