use crate::state::event_state::{subscribe_process_exits, MinecraftProcessExitedPayload};
use crate::support::api;
use crate::support::error::SupportErrorKind;
use crate::support::handler::SessionRef;
use crate::support::service::with_account_token;
use chrono::Utc;
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, Once};
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TempProfileExit {
    Clean,
    Crashed,
    Killed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUp {
    pub exit: TempProfileExit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub played_seconds: Option<u64>,
}

const MAX_ATTEMPTS: u32 = 20;
const RETRY_DELAY: Duration = Duration::from_secs(30);

static WATCHED: Lazy<Mutex<HashMap<Uuid, SessionRef>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn watched() -> std::sync::MutexGuard<'static, HashMap<Uuid, SessionRef>> {
    WATCHED.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn watch(profile_id: Uuid, session: SessionRef) {
    listen();
    watched().insert(profile_id, session);
}

#[cfg(feature = "test-api")]
pub fn is_watched(profile_id: Uuid) -> bool {
    watched().contains_key(&profile_id)
}

pub fn forget(profile_id: Uuid) {
    watched().remove(&profile_id);
}

pub fn exit_kind(exit_code: Option<i32>, stopped_by_user: bool) -> TempProfileExit {
    match exit_code {
        _ if stopped_by_user => TempProfileExit::Killed,
        Some(0) => TempProfileExit::Clean,
        Some(_) => TempProfileExit::Crashed,
        None => TempProfileExit::Killed,
    }
}

pub fn take_report(exit: &MinecraftProcessExitedPayload) -> Option<(SessionRef, FollowUp)> {
    let session = watched().remove(&exit.profile_id)?;
    let played_seconds = exit
        .process_metadata
        .as_ref()
        .map(|m| Utc::now().signed_duration_since(m.start_time).num_seconds().max(0) as u64);
    let report = FollowUp {
        exit: exit_kind(exit.exit_code, exit.was_intentionally_stopped),
        exit_code: exit.exit_code,
        played_seconds,
    };
    Some((session, report))
}

fn listen() {
    static LISTENING: Once = Once::new();
    LISTENING.call_once(|| {
        let mut exits = subscribe_process_exits();
        tokio::spawn(async move {
            loop {
                match exits.recv().await {
                    Ok(exit) => {
                        if let Some((session, report)) = take_report(&exit) {
                            info!("[Support] Test profile ended: {:?}", report.exit);
                            tokio::spawn(send(session, report));
                        }
                    }
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => break,
                }
            }
        });
    });
}

async fn send(session: SessionRef, report: FollowUp) {
    for attempt in 1..=MAX_ATTEMPTS {
        let result = with_account_token(session.account_id, session.is_experimental, |token| {
            let (code, report) = (session.code.clone(), report.clone());
            let experimental = session.is_experimental;
            async move { api::follow_up(&token, &code, experimental, &report).await }
        })
        .await;
        match result {
            Ok(_) => return,
            Err(e) if matches!(e.kind, SupportErrorKind::Gone | SupportErrorKind::NotFound) => {
                warn!("[Support] Follow-up not accepted: {}", e);
                return;
            }
            Err(e) => {
                warn!("[Support] Follow-up attempt {} failed: {}", attempt, e);
                tokio::time::sleep(RETRY_DELAY).await;
            }
        }
    }
}
