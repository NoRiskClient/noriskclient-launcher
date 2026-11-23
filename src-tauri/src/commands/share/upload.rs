use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;

use crate::error::AppError;

const PROGRESS_EVENT: &str = "share_upload_progress";
const CHUNK_BYTES: usize = 256 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
const STALL_AFTER: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShareProgress<'a> {
    id: &'a str,
    phase: &'static str,
    done: u64,
    total: u64,
}

pub(super) struct Progress<'a> {
    app: &'a AppHandle,
    id: &'a str,
}

impl<'a> Progress<'a> {
    pub(super) fn new(app: &'a AppHandle, id: &'a str) -> Self {
        Self { app, id }
    }

    pub(super) fn report(&self, phase: &'static str, done: u64, total: u64) {
        let _ = self.app.emit(PROGRESS_EVENT, ShareProgress { id: self.id, phase, done, total });
    }
}

pub(crate) fn file_body(file: tokio::fs::File, size: u64, sent: Arc<AtomicU64>) -> reqwest::Body {
    let stream = futures::stream::try_unfold(file.take(size), move |mut file| {
        let sent = sent.clone();
        async move {
            let mut chunk = vec![0; CHUNK_BYTES];
            let read = file.read(&mut chunk).await?;
            if read == 0 {
                return Ok(None);
            }
            chunk.truncate(read);
            sent.fetch_add(read as u64, Ordering::Relaxed);
            Ok::<_, std::io::Error>(Some((chunk, file)))
        }
    });
    reqwest::Body::wrap_stream(stream)
}

pub(crate) async fn watch_upload<E: From<AppError>>(
    put: impl Future<Output = Result<(), E>>,
    sent: &AtomicU64,
    size: u64,
    report: impl Fn(u64),
) -> Result<(), E> {
    tokio::pin!(put);
    let mut tick = tokio::time::interval(PROGRESS_EVERY);
    let mut last = 0;
    let mut moved = Instant::now();
    loop {
        tokio::select! {
            done = &mut put => return done,
            _ = tick.tick() => {
                let now = sent.load(Ordering::Relaxed);
                if now != last {
                    last = now;
                    moved = Instant::now();
                    report(now);
                } else if now < size && moved.elapsed() > STALL_AFTER {
                    return Err(AppError::RequestError("the upload stalled".into()).into());
                }
            }
        }
    }
}
