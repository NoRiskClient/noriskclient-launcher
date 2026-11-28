use noriskclient_launcher_v3_lib::minecraft::{
    aot_cache_applies, module_flags, prepare_aot_cache, AotRecording, AOT_CACHE_MIN_JAVA,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const JAVA: &str = "C:/java/zulu_25/bin/javaw.exe";
const CLASSPATH: &str = "C:/libs/a.jar;C:/libs/b.jar";

fn prepare(dir: &Path, classpath: &str) -> (Vec<String>, Option<AotRecording>) {
    prepare_aot_cache(
        dir,
        Path::new(JAVA),
        vec!["--enable-native-access=ALL-UNNAMED".into()],
        classpath,
    )
}

fn configuration(args: &[String]) -> PathBuf {
    assert_eq!(args[0], "-XX:AOTMode=record");
    PathBuf::from(args[1].strip_prefix("-XX:AOTConfiguration=").unwrap())
}

/// The cache a recording turns into: `<key>.aot` next to `<key>-<launch>.aotconf`.
fn cache_for(configuration: &Path) -> PathBuf {
    let name = configuration.file_name().unwrap().to_str().unwrap();
    configuration.with_file_name(format!("{}.aot", name.split('-').next().unwrap()))
}

fn file_aged(path: &Path, age: Duration) {
    fs::File::create(path)
        .unwrap()
        .set_modified(SystemTime::now() - age)
        .unwrap();
}

#[test]
fn applies_only_to_fabric_on_java_25_without_archive_flags_of_its_own() {
    assert!(aot_cache_applies(AOT_CACHE_MIN_JAVA, true, ["-Xmx4G"]));
    assert!(aot_cache_applies(26, true, []));
    assert!(!aot_cache_applies(21, true, []));
    assert!(!aot_cache_applies(25, false, []));
    for user_flag in [
        "-XX:AOTCache=my.aot",
        "-XX:SharedArchiveFile=app.jsa",
        "-Xshare:off",
    ] {
        assert!(
            !aot_cache_applies(25, true, ["-Xmx4G", user_flag]),
            "{user_flag}"
        );
    }
}

#[test]
fn module_flags_keep_their_values() {
    let args = [
        "-Xmx4G",
        "--sun-misc-unsafe-memory-access=allow",
        "--enable-native-access=ALL-UNNAMED",
        "--add-opens",
        "java.base/java.lang=ALL-UNNAMED",
        "-Dfoo=bar",
        "-cp",
        CLASSPATH,
    ];
    assert_eq!(
        module_flags(args),
        [
            "--sun-misc-unsafe-memory-access=allow",
            "--enable-native-access=ALL-UNNAMED",
            "--add-opens",
            "java.base/java.lang=ALL-UNNAMED",
        ],
    );
}

#[test]
fn records_without_a_cache_and_uses_it_once_built() {
    let dir = tempfile::tempdir().unwrap();
    let (args, recording) = prepare(dir.path(), CLASSPATH);
    let conf = configuration(&args);
    assert!(recording.is_some());
    assert_eq!(conf.parent(), Some(dir.path()));

    let cache = cache_for(&conf);
    fs::write(&cache, b"cache").unwrap();
    let (args, recording) = prepare(dir.path(), CLASSPATH);
    assert_eq!(args, [format!("-XX:AOTCache={}", cache.display())]);
    assert!(recording.is_none());
}

#[test]
fn another_classpath_records_its_own_cache() {
    let dir = tempfile::tempdir().unwrap();
    let (args, _) = prepare(dir.path(), CLASSPATH);
    fs::write(cache_for(&configuration(&args)), b"cache").unwrap();

    let (args, recording) = prepare(dir.path(), "C:/libs/a.jar;C:/libs/c.jar");
    configuration(&args);
    assert!(recording.is_some());
}

#[test]
fn keeps_the_three_most_recently_used_caches() {
    let dir = tempfile::tempdir().unwrap();
    let (args, _) = prepare(dir.path(), CLASSPATH);
    let used = cache_for(&configuration(&args));
    file_aged(&used, Duration::from_secs(400));
    for (name, age) in [("b.aot", 300), ("c.aot", 200), ("d.aot", 100)] {
        file_aged(&dir.path().join(name), Duration::from_secs(age));
    }

    prepare(dir.path(), CLASSPATH);

    assert!(used.exists());
    assert!(!dir.path().join("b.aot").exists());
    assert!(dir.path().join("c.aot").exists());
    assert!(dir.path().join("d.aot").exists());
}

#[test]
fn drops_recordings_a_closed_launcher_left_behind() {
    let dir = tempfile::tempdir().unwrap();
    let orphan = dir.path().join("old-1.aotconf");
    let pending = dir.path().join("new-2.aotconf");
    file_aged(&orphan, Duration::from_secs(2 * 60 * 60));
    file_aged(&pending, Duration::from_secs(60));

    prepare(dir.path(), CLASSPATH);

    assert!(!orphan.exists());
    assert!(pending.exists());
}

#[tokio::test]
async fn a_failed_build_leaves_no_files_behind() {
    let dir = tempfile::tempdir().unwrap();
    let (args, recording) = prepare(dir.path(), CLASSPATH);
    let conf = configuration(&args);
    fs::write(&conf, b"recorded").unwrap();

    recording.unwrap().finish(true).await;

    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn a_crashed_game_only_removes_its_recording() {
    let dir = tempfile::tempdir().unwrap();
    let (args, recording) = prepare(dir.path(), CLASSPATH);
    let conf = configuration(&args);
    fs::write(&conf, b"recorded").unwrap();

    recording.unwrap().finish(false).await;

    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}
