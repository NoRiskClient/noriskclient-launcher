use std::path::PathBuf;
use std::sync::Arc;

use log4rs::append::rolling_file::policy::compound::roll::fixed_window::FixedWindowRoller;
use log4rs::append::rolling_file::policy::compound::roll::Roll;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;
pub const ROTATED_BACKUP_COUNT: u32 = 5;
const ROTATE_MARKER: &[u8] = b"[NRC] log rotated -- previous chunk gzipped to nrc-process.log.N.gz; cap is 10 MB per segment, 5 backups.\n";
const FORWARD_BUF_BYTES: usize = 8 * 1024;

pub struct BoundedLogWriter {
    file: Option<File>,
    path: PathBuf,
    bytes_written: u64,
    max_bytes: u64,
    roller: Arc<FixedWindowRoller>,
}

impl BoundedLogWriter {
    pub async fn create(path: PathBuf) -> std::io::Result<Self> {
        Self::create_with_limit(path, MAX_LOG_BYTES).await
    }

    pub async fn create_with_limit(path: PathBuf, max_bytes: u64) -> std::io::Result<Self> {
        let pattern = format!("{}.{{}}.gz", path.display());
        let roller = FixedWindowRoller::builder()
            .base(1)
            .build(&pattern, ROTATED_BACKUP_COUNT)
            .map_err(io_err)?;
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .await?;
        Ok(Self {
            file: Some(file),
            path,
            bytes_written: 0,
            max_bytes,
            roller: Arc::new(roller),
        })
    }

    pub async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        if self
            .bytes_written
            .saturating_add(buf.len() as u64)
            > self.max_bytes
        {
            self.rotate().await?;
        }
        if let Some(file) = self.file.as_mut() {
            file.write_all(buf).await?;
            self.bytes_written = self.bytes_written.saturating_add(buf.len() as u64);
        }
        Ok(())
    }

    async fn rotate(&mut self) -> std::io::Result<()> {
        // Windows: file must be closed before rename.
        if let Some(mut f) = self.file.take() {
            let _ = f.shutdown().await;
            drop(f);
        }

        let path = self.path.clone();
        let roller = self.roller.clone();
        if let Err(e) = tokio::task::spawn_blocking(move || roller.roll(&path))
            .await
            .map_err(io_err)?
        {
            // Roller failed -- reopen primary in append mode so writes survive.
            let reopened = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .await?;
            self.file = Some(reopened);
            return Err(io_err(e));
        }

        let mut new_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
            .await?;
        new_file.write_all(ROTATE_MARKER).await?;
        self.bytes_written = ROTATE_MARKER.len() as u64;
        self.file = Some(new_file);
        Ok(())
    }
}

fn io_err<E: std::fmt::Display>(e: E) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
}

pub async fn forward_pipe<R>(mut reader: R, writer: Arc<Mutex<BoundedLogWriter>>, tag: &'static str)
where
    R: AsyncRead + Unpin,
{
    let mut buf = vec![0u8; FORWARD_BUF_BYTES];
    // Keep draining after write failure; closing the pipe would SIGPIPE the game.
    let mut writes_disabled = false;
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => return,
            Ok(n) => {
                if writes_disabled {
                    continue;
                }
                let mut w = writer.lock().await;
                if let Err(e) = w.write_all(&buf[..n]).await {
                    log::warn!(
                        "[Log Archive] {} write failed, dropping further bytes for this session: {}",
                        tag,
                        e
                    );
                    writes_disabled = true;
                }
            }
            Err(e) => {
                log::warn!("[Log Archive] {} pipe read failed: {}", tag, e);
                return;
            }
        }
    }
}
