use noriskclient_launcher_v3_lib::minecraft::dto::piston_meta::Arguments;
use noriskclient_launcher_v3_lib::minecraft::{
    base64_intrinsics_mitigation, BASE64_INTRINSICS_MIN_JAVA, BASE64_INTRINSICS_MITIGATION,
};

#[test]
fn java_8_gets_no_flags_it_would_not_start_with() {
    assert!(base64_intrinsics_mitigation(8, []).is_empty());
}

#[test]
fn modern_java_gets_both_flags_unlock_first() {
    for major in [BASE64_INTRINSICS_MIN_JAVA, 17, 21, 25] {
        assert_eq!(base64_intrinsics_mitigation(major, []), BASE64_INTRINSICS_MITIGATION);
    }
}

#[test]
fn flags_already_set_by_the_user_are_not_added_twice() {
    let custom = ["-Xss2M", "-XX:+UnlockDiagnosticVMOptions", "-XX:-UseBASE64Intrinsics"];
    assert!(base64_intrinsics_mitigation(21, custom).is_empty());
}

#[test]
fn only_the_missing_flag_is_added() {
    assert_eq!(
        base64_intrinsics_mitigation(21, ["-XX:+UnlockDiagnosticVMOptions"]),
        vec!["-XX:-UseBASE64Intrinsics"],
    );
}

#[test]
fn flags_from_the_mojang_manifest_count_as_set() {
    let arguments: Arguments = serde_json::from_value(serde_json::json!({
        "game": [],
        "jvm": [
            { "rules": [{ "action": "allow", "os": { "name": "osx" } }], "value": ["-XstartOnFirstThread"] },
            "-XX:+UnlockDiagnosticVMOptions",
            "-XX:-UseBASE64Intrinsics",
            "-cp",
            "${classpath}"
        ]
    }))
    .unwrap();

    assert!(base64_intrinsics_mitigation(21, arguments.simple_jvm()).is_empty());
}
