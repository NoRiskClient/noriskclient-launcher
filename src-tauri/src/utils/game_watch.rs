
use std::sync::Arc;
use std::time::Duration;

use crate::state::state_manager::State;

const LOOK_EVERY: Duration = Duration::from_secs(2);

pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(LOOK_EVERY).await;
            if let Err(e) = tick().await {
                log::debug!("Game watch skipped a turn: {e}");
            }
        }
    });
}

async fn tick() -> anyhow::Result<()> {
    let state = State::get()
        .await
        .map_err(|e| anyhow::anyhow!("no launcher state: {e}"))?;

    let clips = state.config_manager.get_config().await.clips;
    if !clips.enabled {
        return Ok(());
    }

    let supervisor = Arc::clone(&state.capture_supervisor);

    if let Some(pid) = supervisor.attached() {
        if !is_alive(pid) {
            log::info!("The recorded program (pid {pid}) is gone; detaching");
            let _ = supervisor.detach();
        }
    }

    let Some(chosen) = clips.other_game.as_ref() else {
        return Ok(());
    };

    let Some(front) = crate::utils::game_detect::foreground_app() else {
        return Ok(());
    };

    if !clips.records(&front.executable) {
        return Ok(());
    }

    if supervisor.attached() == Some(front.pid) {
        return Ok(());
    }

    log::info!(
        "Recording {} ({}, pid {})",
        chosen.name,
        front.executable,
        front.pid
    );
    if let Err(e) = supervisor.attach_game(front.pid, chosen.name.clone()) {
        log::warn!("Could not point the capture engine at {}: {e}", chosen.name);
    }

    Ok(())
}

#[cfg(windows)]
fn is_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };

        let mut code = 0u32;
        let alive = match GetExitCodeProcess(handle, &mut code) {
            Ok(()) => code == STILL_ACTIVE.0 as u32,
            Err(_) => true,
        };
        let _ = CloseHandle(handle);
        alive
    }
}

#[cfg(not(windows))]
fn is_alive(_pid: u32) -> bool {
    false
}
