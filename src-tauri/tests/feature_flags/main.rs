use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::Router;
use noriskclient_launcher_v3_lib::feature_flags::{FeatureFlags, FlagSource, FlagStore};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Default)]
struct Backend {
    reply: Mutex<(u16, String)>,
    queries: Mutex<Vec<HashMap<String, String>>>,
}

impl Backend {
    fn answer(&self, status: u16, body: serde_json::Value) {
        *self.reply.lock().unwrap() = (status, body.to_string());
    }

    fn last_query(&self) -> HashMap<String, String> {
        self.queries.lock().unwrap().last().cloned().unwrap()
    }
}

async fn flags(
    State(backend): State<Arc<Backend>>,
    Query(query): Query<HashMap<String, String>>,
) -> (StatusCode, String) {
    backend.queries.lock().unwrap().push(query);
    let (status, body) = backend.reply.lock().unwrap().clone();
    (StatusCode::from_u16(status).unwrap(), body)
}

async fn serve() -> (Arc<Backend>, String) {
    let backend = Arc::new(Backend::default());
    let app = Router::new()
        .route("/api/v1/payback/flags", get(flags))
        .with_state(backend.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://{}/api/v1/payback/flags",
        listener.local_addr().unwrap()
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (backend, url)
}

fn source(url: &str, uuid: Option<Uuid>) -> FlagSource {
    FlagSource {
        url: url.to_string(),
        uuid,
    }
}

fn parsed(value: serde_json::Value) -> FeatureFlags {
    serde_json::from_value(value).unwrap()
}

#[derive(Debug, Deserialize, PartialEq)]
struct Notice {
    id: String,
}

#[test]
fn an_enabled_flag_is_on_and_gives_its_value() {
    let flags = parsed(json!({"flags": {
        "launcher.notice": {"enabled": true, "value": [{"id": "a"}]},
        "launcher.applixir": {"enabled": true, "value": null}
    }}));

    assert!(flags.is_on("launcher.notice"));
    assert!(flags.is_on("launcher.applixir"));
    assert_eq!(flags.value("launcher.applixir"), None);
    assert_eq!(
        flags.value_as::<Vec<Notice>>("launcher.notice"),
        Some(vec![Notice { id: "a".into() }])
    );
}

#[test]
fn a_disabled_flag_is_off_and_hides_its_value() {
    let flags = parsed(json!({"flags": {
        "launcher.notice": {"enabled": false, "value": [{"id": "a"}]}
    }}));

    assert!(!flags.is_on("launcher.notice"));
    assert_eq!(flags.value("launcher.notice"), None);
}

#[test]
fn an_unknown_flag_is_off() {
    let flags = parsed(json!({"flags": {}}));

    assert!(!flags.is_on("does.not-exist"));
    assert_eq!(flags.value("does.not-exist"), None);
}

#[test]
fn a_value_of_the_wrong_shape_reads_as_missing() {
    let flags = parsed(json!({"flags": {
        "launcher.notice": {"enabled": true, "value": "not a list"}
    }}));

    assert_eq!(flags.value_as::<Vec<Notice>>("launcher.notice"), None);
}

#[test]
fn the_base_url_follows_experimental_mode() {
    assert_eq!(
        FlagSource::new(false, None).url,
        "https://api.norisk.gg/api/v1/payback/flags"
    );
    assert_eq!(
        FlagSource::new(true, None).url,
        "https://api-staging.norisk.gg/api/v1/payback/flags"
    );
}

#[tokio::test]
async fn the_minecraft_uuid_is_sent_only_with_an_account() {
    let (backend, url) = serve().await;
    backend.answer(200, json!({"flags": {}}));
    let store = FlagStore::default();
    let uuid = Uuid::new_v4();

    store.refresh(&source(&url, None)).await;
    assert_eq!(backend.last_query().get("uuid"), None);

    store.refresh(&source(&url, Some(uuid))).await;
    assert_eq!(backend.last_query().get("uuid"), Some(&uuid.to_string()));
}

#[tokio::test]
async fn without_any_answer_everything_is_off() {
    let (backend, url) = serve().await;
    backend.answer(500, json!({"error": "down"}));
    let store = FlagStore::default();

    let (flags, changed) = store.refresh(&source(&url, None)).await;

    assert!(!changed);
    assert!(!flags.is_on("launcher.applixir"));
}

#[tokio::test]
async fn a_failed_refresh_keeps_the_last_good_flags() {
    let (backend, url) = serve().await;
    let store = FlagStore::default();
    backend.answer(200, json!({"flags": {"launcher.applixir": {"enabled": true}}}));
    store.refresh(&source(&url, None)).await;

    backend.answer(500, json!({"error": "down"}));
    let (flags, changed) = store.refresh(&source(&url, None)).await;

    assert!(!changed);
    assert!(flags.is_on("launcher.applixir"));
    assert!(store.snapshot().is_on("launcher.applixir"));
}

#[tokio::test]
async fn fresh_flags_are_not_fetched_again_until_the_account_changes() {
    let (backend, url) = serve().await;
    backend.answer(200, json!({"flags": {"launcher.applixir": {"enabled": true}}}));
    let store = FlagStore::default();

    let (_, changed) = store.current(&source(&url, None)).await;
    assert!(changed);
    store.current(&source(&url, None)).await;
    assert_eq!(backend.queries.lock().unwrap().len(), 1);

    store.current(&source(&url, Some(Uuid::new_v4()))).await;
    assert_eq!(backend.queries.lock().unwrap().len(), 2);
}
