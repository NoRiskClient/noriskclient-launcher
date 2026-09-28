
use std::sync::Arc;
use std::time::Duration;

use crate::state::state_manager::State;

const LOOK_EVERY: Duration = Duration::from_secs(2);

static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn spawn() {
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

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

    let attached = supervisor.attached();
    let attached_screen = supervisor.attached_screen();
    let front = crate::utils::game_detect::foreground_app();

    if let (Some(chosen), Some(front)) = (clips.other_game.as_ref(), front.as_ref()) {
        if clips.records(&front.executable) {
            if attached != Some(front.pid) {
                point_at(&supervisor, front.pid, &chosen.name);
            }
            return Ok(());
        }
    }

    let minecraft = crate::utils::window_finder::find_running_game();

    if let Some(screen) = clips.other_screen.as_ref() {
        let minecraft_in_front = minecraft
            .filter(|pid| front.as_ref().is_some_and(|app| app.pid == *pid));
        match minecraft_in_front {
            Some(pid) if attached != Some(pid) => point_at(&supervisor, pid, "Minecraft"),
            Some(_) => {}
            None if attached_screen.as_deref() != Some(screen.device.as_str()) => {
                log::info!("Recording screen {} ({})", screen.name, screen.device);
                if let Err(e) = supervisor.attach_screen(screen.device.clone(), screen.name.clone()) {
                    log::warn!("Could not point the capture engine at screen {}: {e}", screen.device);
                }
            }
            None => {}
        }
        return Ok(());
    }

    if attached_screen.is_some() {
        log::info!("No screen is chosen any more; stopping its recording");
        let _ = supervisor.detach();
    }

    let Some(minecraft) = minecraft else {
        return Ok(());
    };
    if attached == Some(minecraft) {
        return Ok(());
    }

    let minecraft_in_front = front.as_ref().is_some_and(|app| app.pid == minecraft);
    if attached.is_none() || minecraft_in_front {
        point_at(&supervisor, minecraft, "Minecraft");
    }

    Ok(())
}

fn point_at(supervisor: &crate::state::capture_state::CaptureSupervisor, pid: u32, name: &str) {
    log::info!("Recording {name} (pid {pid})");
    if let Err(e) = supervisor.attach_game(pid, name.to_string()) {
        log::warn!("Could not point the capture engine at {name}: {e}");
    }
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

#[cfg(not(any(windows, target_os = "macos")))]
fn is_alive(_pid: u32) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn is_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
}
