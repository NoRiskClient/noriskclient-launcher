use super::prepare_item;
use crate::temp_dir;
use noriskclient_launcher_v3_lib::support::handlers::logs::{summarize_crash_report, summarize_hs_err};
use std::path::Path;
use std::time::{Duration, SystemTime};

fn jvm_crash_sent(instance: &Path) -> Option<String> {
    prepare_item("JVM_CRASH", instance, 1024 * 1024)
        .file
        .map(|f| f.to_string())
}

fn hs_err(instance: &Path, pid: u32, age_secs: u64) {
    let path = instance.join(format!("hs_err_pid{}.log", pid));
    std::fs::write(&path, format!("# crash of pid {}\n", pid)).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(age_secs))
        .unwrap();
}

#[test]
fn the_jvm_crash_named_in_the_last_game_log_is_sent_over_a_newer_one() {
    let instance = temp_dir("jvm-crash-referenced");
    std::fs::create_dir_all(instance.join("logs")).unwrap();
    std::fs::write(
        instance.join("logs/latest.log"),
        "#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n# An error report file with more information is saved as:\n# C:\\games\\hs_err_pid111.log\n",
    )
    .unwrap();
    hs_err(&instance, 111, 600);
    hs_err(&instance, 222, 60);

    assert_eq!(jvm_crash_sent(&instance).as_deref(), Some("# crash of pid 111\n"));
}

#[test]
fn without_a_named_jvm_crash_the_newest_one_is_sent() {
    let instance = temp_dir("jvm-crash-newest");
    hs_err(&instance, 111, 600);
    hs_err(&instance, 222, 60);
    std::fs::write(instance.join("hs_err_pid333.log.txt"), "# not a crash log\n").unwrap();

    assert_eq!(jvm_crash_sent(&instance).as_deref(), Some("# crash of pid 222\n"));
}

#[test]
fn summarizes_hs_err() {
    let content = "\
#
# A fatal error has been detected by the Java Runtime Environment:
#
#  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb1c2a4d17, pid=15624, tid=4711
#
# JRE version: OpenJDK Runtime Environment Microsoft-9388422 (21.0.3+9) (build 21.0.3+9-LTS)
# Problematic frame:
# V  [jvm.dll+0x464d17]
";
    assert_eq!(
        summarize_hs_err(content).unwrap(),
        "EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb1c2a4d17, pid=15624, tid=4711 | V  [jvm.dll+0x464d17]"
    );
}

#[test]
fn summarizes_crash_report() {
    let content =
        "---- Minecraft Crash Report ----\n// Oops\n\nTime: x\nDescription: Rendering overlay\n";
    assert_eq!(
        summarize_crash_report(content).unwrap(),
        "Rendering overlay"
    );
}
