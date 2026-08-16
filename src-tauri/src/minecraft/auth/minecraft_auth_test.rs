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
fn keeps_cached_credentials_on_captive_portal_body() {
    assert!(keep_cached_credentials_reason(&deserialize_failure(StatusCode::OK)).is_some());
}

#[test]
fn keeps_cached_credentials_on_rate_limit_and_server_errors() {
    assert!(
        keep_cached_credentials_reason(&deserialize_failure(StatusCode::TOO_MANY_REQUESTS))
            .is_some()
    );
    assert!(
        keep_cached_credentials_reason(&deserialize_failure(StatusCode::INTERNAL_SERVER_ERROR))
            .is_some()
    );
    assert!(keep_cached_credentials_reason(&deserialize_failure(StatusCode::BAD_GATEWAY)).is_some());
}

#[test]
fn does_not_mask_real_auth_rejections() {
    assert!(keep_cached_credentials_reason(&deserialize_failure(StatusCode::BAD_REQUEST)).is_none());
    assert!(
        keep_cached_credentials_reason(&deserialize_failure(StatusCode::UNAUTHORIZED)).is_none()
    );
    assert!(keep_cached_credentials_reason(&deserialize_failure(StatusCode::FORBIDDEN)).is_none());
}

#[test]
fn ignores_unrelated_errors() {
    assert!(keep_cached_credentials_reason(&AppError::NoCredentialsError).is_none());
    assert!(keep_cached_credentials_reason(&AppError::Other("boom".to_string())).is_none());
}

// api_utils builds RequestError from any non-2xx status, so it carries server
// rejections (401/403) as well as transport failures. Treating it as unreachable
// would strand the user on dead credentials instead of prompting a re-login.
#[test]
fn does_not_treat_request_error_as_unreachable() {
    assert!(keep_cached_credentials_reason(&AppError::RequestError(
        "Request failed with status 401 Unauthorized".to_string()
    ))
    .is_none());
}

#[test]
fn offline_toast_only_on_true_unreachable() {
    assert!(!is_offline_error(&deserialize_failure(StatusCode::OK)));
    assert!(!is_offline_error(&deserialize_failure(StatusCode::TOO_MANY_REQUESTS)));
    assert!(!is_offline_error(&deserialize_failure(StatusCode::INTERNAL_SERVER_ERROR)));
    assert!(!is_offline_error(&deserialize_failure(StatusCode::BAD_REQUEST)));
    assert!(!is_offline_error(&AppError::RequestError("boom".to_string())));
    assert!(!is_offline_error(&AppError::NoCredentialsError));
}
