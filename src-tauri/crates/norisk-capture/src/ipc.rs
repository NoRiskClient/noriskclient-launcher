use std::sync::mpsc::Sender;

use anyhow::{Context, Result};
use norisk_ipc::{decode_line, encode_line, CaptureToLauncher, LauncherToCapture};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc::UnboundedReceiver;

pub async fn serve(
    pipe_name: &str,
    commands: Sender<LauncherToCapture>,
    mut events: UnboundedReceiver<CaptureToLauncher>,
) -> Result<()> {
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name)
        .with_context(|| format!("could not create the pipe {pipe_name}"))?;

    log::info!("Waiting for the launcher on {pipe_name}");
    server
        .connect()
        .await
        .context("waiting for a launcher connection failed")?;
    log::info!("Launcher connected");

    let (reader, mut writer) = tokio::io::split(server);
    let mut lines = BufReader::new(reader).lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) if line.trim().is_empty() => continue,
                    Ok(Some(line)) => {
                        match decode_line::<LauncherToCapture>(&line) {
                            Ok(command) => {
                                let shutdown = matches!(command, LauncherToCapture::Shutdown);
                                if commands.send(command).is_err() {
                                    log::warn!("Engine is gone; closing the connection");
                                    return Ok(());
                                }
                                if shutdown {
                                    return Ok(());
                                }
                            }
                            Err(e) => {
                                log::warn!("Refusing an undecodable message: {e}");
                                if let Ok(line) = encode_line(&refusal(&e)) {
                                    if writer.write_all(line.as_bytes()).await.is_err() {
                                        return Ok(());
                                    }
                                    let _ = writer.flush().await;
                                }
                            }
                        }
                    }
                    Ok(None) => {
                        log::info!("Launcher disconnected");
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!("Read failed: {e}");
                        return Ok(());
                    }
                }
            }

            event = events.recv() => {
                let Some(event) = event else {
                    log::info!("Event channel closed");
                    return Ok(());
                };
                let line = match encode_line(&event) {
                    Ok(line) => line,
                    Err(e) => {
                        log::error!("Could not encode an event: {e}");
                        continue;
                    }
                };
                if let Err(e) = writer.write_all(line.as_bytes()).await {
                    log::info!("Write failed, launcher likely gone: {e}");
                    return Ok(());
                }
                let _ = writer.flush().await;
            }
        }
    }
}

fn refusal(error: impl std::fmt::Display) -> CaptureToLauncher {
    CaptureToLauncher::Error(norisk_ipc::CaptureError {
        code: norisk_ipc::ErrorCode::Protocol,
        message: format!(
            "The capture engine could not read a request from the launcher ({error}). \
             Restart the launcher so both halves are the same version."
        ),
        recoverable: true,
    })
}

pub fn create(pipe_name: &str) -> Result<NamedPipeServer> {
    ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name)
        .with_context(|| format!("could not create the pipe {pipe_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protocol_error(line: &str) -> norisk_ipc::CaptureError {
        let error = decode_line::<LauncherToCapture>(line).expect_err("the line should not decode");
        match refusal(&error) {
            CaptureToLauncher::Error(error) => error,
            other => panic!("expected an error back, got {other:?}"),
        }
    }

    #[test]
    fn a_request_the_engine_does_not_know_is_answered_rather_than_swallowed() {
        let error = protocol_error(r#"{"type":"no_such_request"}"#);
        assert_eq!(error.code, norisk_ipc::ErrorCode::Protocol);
        assert!(error.recoverable, "one unreadable request must not take the engine down");
        assert!(error.message.contains("no_such_request"), "{}", error.message);
    }

    #[test]
    fn a_broken_line_is_answered_too() {
        let error = protocol_error("{not json");
        assert_eq!(error.code, norisk_ipc::ErrorCode::Protocol);
        assert!(error.message.contains("Restart the launcher"), "{}", error.message);
    }
}
