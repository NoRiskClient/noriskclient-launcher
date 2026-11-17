use std::path::{Path, PathBuf};

use serde::Deserialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};

const START_SLACK_MS: i64 = 5_000;

#[derive(Deserialize)]
struct GameSession {
    pid: i64,
    #[serde(default)]
    server: Option<String>,
    #[serde(default)]
    since: Option<i64>,
}

fn dir() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join("game-sessions")
}

pub fn server_of(pid: u32) -> Option<String> {
    server_in(&dir(), pid, started_ms(pid))
}

pub fn server_in(dir: &Path, pid: u32, started_ms: Option<i64>) -> Option<String> {
    let path = dir.join(format!("{pid}.json"));
    let bytes = std::fs::read(&path).ok()?;
    let session: GameSession = serde_json::from_slice(&bytes)
        .inspect_err(|e| log::debug!("Ignoring an unreadable {}: {e}", path.display()))
        .ok()?;
    if session.pid != i64::from(pid) {
        return None;
    }
    if let (Some(since), Some(started)) = (session.since, started_ms) {
        if since + START_SLACK_MS < started {
            log::debug!("{} is left over from an earlier game with the same pid", path.display());
            return None;
        }
    }
    let server = session.server?.trim().to_string();
    (!server.is_empty()).then_some(server)
}

fn started_ms(pid: u32) -> Option<i64> {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), false);
    system
        .process(pid)
        .map(|process| process.start_time() as i64 * 1000)
}

pub fn remove_stale() {
    remove_stale_in(&dir(), |pids| {
        let wanted: Vec<Pid> = pids.iter().map(|pid| Pid::from_u32(*pid)).collect();
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&wanted), false);
        pids.iter()
            .map(|pid| system.process(Pid::from_u32(*pid)).is_some())
            .collect()
    });
}

pub fn remove_stale_in(dir: &Path, running: impl FnOnce(&[u32]) -> Vec<bool>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let files: Vec<(u32, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter_map(|path| {
            let pid = path.file_name()?.to_str()?.strip_suffix(".json")?.parse().ok()?;
            Some((pid, path))
        })
        .collect();
    if files.is_empty() {
        return;
    }

    let pids: Vec<u32> = files.iter().map(|(pid, _)| *pid).collect();
    let mut removed = 0;
    for ((_, path), alive) in files.iter().zip(running(&pids)) {
        if !alive && std::fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        log::info!("Removed {removed} game session file(s) of games that are gone");
    }
}
