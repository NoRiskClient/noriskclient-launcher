use noriskclient_launcher_v3_lib::minecraft::{base64_intrinsics_mitigation, BASE64_INTRINSICS_MIN_JAVA};

#[test]
fn java_8_gets_no_flags_it_would_not_start_with() {
    assert!(base64_intrinsics_mitigation(8).is_empty());
}

#[test]
fn modern_java_disables_the_base64_intrinsic() {
    for major in [BASE64_INTRINSICS_MIN_JAVA, 17, 21, 25] {
        assert_eq!(
            base64_intrinsics_mitigation(major),
            vec!["-XX:+UnlockDiagnosticVMOptions", "-XX:-UseBASE64Intrinsics"],
        );
    }
}

#[test]
fn unlock_comes_before_the_diagnostic_flag() {
    let args = base64_intrinsics_mitigation(21);
    let unlock = args.iter().position(|a| a == "-XX:+UnlockDiagnosticVMOptions").unwrap();
    let flag = args.iter().position(|a| a == "-XX:-UseBASE64Intrinsics").unwrap();
    assert!(unlock < flag);
}
