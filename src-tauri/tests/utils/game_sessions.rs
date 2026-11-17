use std::path::PathBuf;

use noriskclient_launcher_v3_lib::utils::game_sessions::{remove_stale_in, server_in};

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
