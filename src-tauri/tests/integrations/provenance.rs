use noriskclient_launcher_v3_lib::integrations::provenance::*;

fn names(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[test]
fn a_jar_in_the_mods_folder_is_expected_content() {
    let report = classify_executable_entries(
        names(&["overrides/mods/sodium.jar", "overrides/mods/iris.jar"]),
        &["overrides/"],
    );

    assert!(report.natives.is_empty());
    assert_eq!(report.native_count, 0);
}

#[test]
fn a_jar_outside_the_mods_folder_is_flagged() {
    let report =
        classify_executable_entries(names(&["overrides/config/agent.jar"]), &["overrides/"]);

    assert_eq!(report.natives, vec!["overrides/config/agent.jar"]);
    assert_eq!(report.native_count, 1);
}

#[test]
fn scripts_and_natives_land_in_separate_buckets() {
    let report = classify_executable_entries(
        names(&[
            "overrides/scripts/crafttweaker.zs",
            "overrides/run.bat",
            "overrides/kubejs/startup.js",
            "overrides/lib/native.dll",
        ]),
        &["overrides/"],
    );

    assert_eq!(
        report.scripts,
        vec!["overrides/kubejs/startup.js", "overrides/scripts/crafttweaker.zs"]
    );
    assert_eq!(report.natives, vec!["overrides/lib/native.dll", "overrides/run.bat"]);
    assert!(!report.truncated);
}

#[test]
fn entries_outside_the_scanned_prefix_are_ignored() {
    let report = classify_executable_entries(
        names(&["client-overrides/run.bat", "overrides/run.bat"]),
        &["overrides/"],
    );

    assert_eq!(report.natives, vec!["overrides/run.bat"]);
}

#[test]
fn an_empty_prefix_scans_plain_relative_paths() {
    let report = classify_executable_entries(
        names(&["mods/sodium.jar", "config/agent.jar", "run.sh"]),
        &[""],
    );

    assert_eq!(report.natives, vec!["config/agent.jar", "run.sh"]);
}

#[test]
fn directory_entries_and_extensionless_files_are_skipped() {
    let report = classify_executable_entries(
        names(&["overrides/mods/", "overrides/LICENSE", "overrides/run.bat"]),
        &["overrides/"],
    );

    assert_eq!(report.natives, vec!["overrides/run.bat"]);
    assert!(report.scripts.is_empty());
}

#[test]
fn long_listings_are_truncated_and_flagged() {
    let entries: Vec<String> = (0..60)
        .map(|index| format!("overrides/tool-{:02}.bat", index))
        .collect();

    let report = classify_executable_entries(entries, &["overrides/"]);

    assert_eq!(report.native_count, 60);
    assert_eq!(report.natives.len(), 40);
    assert!(report.truncated);
}

#[test]
fn matching_is_case_insensitive() {
    let report = classify_executable_entries(
        names(&["Overrides/Run.BAT", "OVERRIDES/MODS/Sodium.JAR"]),
        &["overrides/"],
    );

    assert_eq!(report.natives, vec!["Overrides/Run.BAT"]);
}
