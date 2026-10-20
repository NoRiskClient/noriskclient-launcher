use crate::temp_dir;
use crate::test_ctx;
use async_trait::async_trait;
use noriskclient_launcher_v3_lib::support::error::SupportErrorKind;
use noriskclient_launcher_v3_lib::support::handler::{
    ActionOutcome, PreparedItem, SupportContext, SupportItemHandler,
};
use noriskclient_launcher_v3_lib::support::registry::REGISTRY;
use noriskclient_launcher_v3_lib::support::service::*;
use noriskclient_launcher_v3_lib::support::types::{
    ActionPlanView, ItemCategory, ItemParams, ItemStatus, RemoteSupportRequest,
};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Notify;

fn entry(item_type: &str, prepared: Option<PreparedItem>) -> PreparedEntry {
    PreparedEntry::new(item_type, REGISTRY.get(item_type), prepared)
}

#[test]
fn builds_one_result_per_item_with_correct_statuses() {
    let file = PreparedItem::file("log".to_string(), None, false);
    let mut executed = entry(
        "UPDATE_LOADER",
        Some(PreparedItem::action(
            ActionPlanView {
                description: "x".into(),
                from: Some("1".into()),
                to: Some("2".into()),
                ..Default::default()
            },
            json!({}),
        )),
    );
    executed.outcome = Some(ActionOutcome::done(
        "ok",
        Some(json!({"from": "1", "to": "2"})),
    ));
    let unsupported = entry("FUTURE_THING", None);

    let entries = vec![
        entry("MC_LATEST_LOG", Some(file.clone())),
        entry("LAUNCHER_LOG", Some(file)),
        entry(
            "MC_LATEST_CRASH",
            Some(PreparedItem::missing("none")),
        ),
        entry(
            "JVM_CRASH",
            Some(PreparedItem::failed("file rejected")),
        ),
        entry(
            "MOD_LIST",
            Some(PreparedItem::data(json!({"mods": []}), None)),
        ),
        executed,
        entry(
            "UPDATE_LOADER",
            Some(PreparedItem::action(
                ActionPlanView {
                    description: "y".into(),
                    ..Default::default()
                },
                json!({}),
            )),
        ),
        unsupported,
    ];
    let (results, files) = build_submission(&entries, &[0, 2, 4, 5]);
    let statuses: Vec<ItemStatus> = results.iter().map(|r| r.status).collect();
    assert_eq!(
        statuses,
        vec![
            ItemStatus::Done,
            ItemStatus::Declined,
            ItemStatus::Missing,
            ItemStatus::Failed,
            ItemStatus::Done,
            ItemStatus::Done,
            ItemStatus::Declined,
            ItemStatus::Unsupported,
        ]
    );
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].part_name, "MC_LATEST_LOG");
    assert_eq!(results[4].data, Some(json!({"mods": []})));
    assert_eq!(results[5].data, Some(json!({"from": "1", "to": "2"})));
}

fn noisy_text(lines: usize) -> String {
    let mut seed: u64 = 0x9E3779B97F4A7C15;
    let mut out = String::new();
    for i in 0..lines {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        out.push_str(&format!(
            "{} {:016x}{:016x}\n",
            i,
            seed,
            seed.rotate_left(29)
        ));
    }
    out
}

#[test]
fn compresses_and_shrinks_largest_file_to_fit_upload_limit() {
    use std::io::Read;
    let big = std::sync::Arc::new(noisy_text(60_000));
    let small = std::sync::Arc::new(noisy_text(500));
    let files = vec![
        PendingFile {
            result_index: 0,
            part_name: "MC_LATEST_LOG".into(),
            content: big.clone(),
        },
        PendingFile {
            result_index: 3,
            part_name: "LAUNCHER_LOG".into(),
            content: small.clone(),
        },
    ];
    let unlimited = gzip(&big).unwrap().len() + gzip(&small).unwrap().len();
    let limit = (unlimited / 3) as u64;
    let (parts, _) = compress_to_fit(files, limit).unwrap();
    let total: usize = parts.iter().map(|p| p.gzip_bytes.len()).sum();
    assert!(total as u64 <= limit, "{} > {}", total, limit);

    let mut decoded = String::new();
    flate2::read::GzDecoder::new(&parts[0].gzip_bytes[..])
        .read_to_string(&mut decoded)
        .unwrap();
    assert!(decoded.len() < big.len() && decoded.contains("NoRisk Launcher:"));

    let mut small_decoded = String::new();
    flate2::read::GzDecoder::new(&parts[1].gzip_bytes[..])
        .read_to_string(&mut small_decoded)
        .unwrap();
    assert_eq!(small_decoded, *small);
}

#[test]
fn upload_limit_that_cannot_be_met_is_too_large() {
    let files = vec![PendingFile {
        result_index: 0,
        part_name: "MC_LATEST_LOG".into(),
        content: std::sync::Arc::new(noisy_text(20_000)),
    }];
    let err = compress_to_fit(files, 1024).err().unwrap();
    assert_eq!(err.kind, SupportErrorKind::TooLarge);
}

struct GatedAction {
    started: Notify,
    release: Notify,
    runs: AtomicUsize,
}

#[async_trait]
impl SupportItemHandler for GatedAction {
    fn type_id(&self) -> &'static str {
        "UPDATE_LOADER"
    }

    fn category(&self) -> ItemCategory {
        ItemCategory::Action
    }

    async fn prepare(&self, _ctx: &SupportContext, _params: &ItemParams) -> PreparedItem {
        PreparedItem::default()
    }

    async fn execute(
        &self,
        _ctx: &SupportContext,
        _params: &ItemParams,
        _prepared: &PreparedItem,
    ) -> ActionOutcome {
        self.runs.fetch_add(1, Ordering::SeqCst);
        self.started.notify_one();
        self.release.notified().await;
        ActionOutcome::done("loader updated", None)
    }
}

fn remote_request() -> RemoteSupportRequest {
    serde_json::from_value(json!({
        "requestId": "r1", "ticketId": 1, "ticketNumber": 7, "category": "CRASH",
        "requestedBy": { "displayName": "Staffer" },
        "items": [ { "type": "UPDATE_LOADER" } ],
        "createdAt": "2026-10-13T10:00:00Z", "expiresAt": "2026-10-14T10:00:00Z"
    }))
    .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn opening_the_link_again_while_an_action_runs_is_busy_and_keeps_its_result() {
    let code = "BUSYTEST-01";
    let account = uuid::Uuid::new_v4();
    let action: &'static GatedAction = Box::leak(Box::new(GatedAction {
        started: Notify::new(),
        release: Notify::new(),
        runs: AtomicUsize::new(0),
    }));
    let plan = PreparedItem::action(ActionPlanView::default(), json!({}));
    open_session(code, remote_request(), account, false).await.unwrap();
    store_prepared(
        code,
        account,
        test_ctx(&temp_dir("busy"), 1024),
        vec![PreparedEntry::new("UPDATE_LOADER", Some(action), Some(plan))],
    )
    .await
    .unwrap();

    let running = tokio::spawn(execute_action(code, 0));
    action.started.notified().await;

    let reopened = open_session(code, remote_request(), account, false).await;
    assert_eq!(reopened.err().map(|e| e.kind), Some(SupportErrorKind::Busy));

    action.release.notify_one();
    assert_eq!(running.await.unwrap().unwrap().status, ItemStatus::Done);

    let again = execute_action(code, 0).await.unwrap();
    assert_eq!(again.status, ItemStatus::Done);
    assert_eq!(action.runs.load(Ordering::SeqCst), 1);
}
