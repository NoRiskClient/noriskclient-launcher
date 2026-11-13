//! What the NoRisk Client in a running game says it is connected to: `<meta>/game-sessions/<pid>.json`.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};

/// Slack between the game starting and the client writing its first file.
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

/// The server the game with `pid` is on right now, if its client says so.
pub fn server_of(pid: u32) -> Option<String> {
    server_in(&dir(), pid, started_ms(pid))
}

fn server_in(dir: &Path, pid: u32, started_ms: Option<i64>) -> Option<String> {
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

/// Drops the files of games that are no longer running, e.g. after a crash.
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

fn remove_stale_in(dir: &Path, running: impl FnOnce(&[u32]) -> Vec<bool>) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nrc-game-sessions-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_server_comes_from_the_games_own_file() {
        let dir = scratch("read");
        std::fs::write(
            dir.join("4242.json"),
            r#"{"pid":4242,"server":"hypixel.net","since":1763000000000}"#,
        )
        .unwrap();
        std::fs::write(dir.join("5151.json"), r#"{"pid":5151,"server":null,"since":1763000000000}"#)
            .unwrap();
        std::fs::write(dir.join("6161.json"), r#"{"pid":7171,"server":"gommehd.net","since":1}"#)
            .unwrap();
        std::fs::write(dir.join("8181.json"), "{\"pid\":81").unwrap();
        std::fs::write(dir.join("9292.json"), r#"{"pid":9292,"server":"  ","since":1}"#).unwrap();

        assert_eq!(server_in(&dir, 4242, None), Some("hypixel.net".into()), "valid");
        assert_eq!(server_in(&dir, 4242, Some(1_763_000_001_000)), Some("hypixel.net".into()));
        assert_eq!(server_in(&dir, 5151, None), None, "singleplayer or LAN");
        assert_eq!(server_in(&dir, 6161, None), None, "written for another pid");
        assert_eq!(server_in(&dir, 8181, None), None, "half written");
        assert_eq!(server_in(&dir, 9191, None), None, "missing");
        assert_eq!(server_in(&dir, 9292, None), None, "blank");
        assert_eq!(
            server_in(&dir, 4242, Some(1_763_000_000_000 + 60_000)),
            None,
            "left over from an earlier game with the same pid"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn files_of_games_that_are_gone_are_removed() {
        let dir = scratch("stale");
        for name in ["100.json", "200.json", "notes.txt", "300.json.tmp"] {
            std::fs::write(dir.join(name), "{}").unwrap();
        }
        remove_stale_in(&dir, |pids| pids.iter().map(|pid| *pid == 200).collect());

        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, vec!["200.json", "300.json.tmp", "notes.txt"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
