use noriskclient_launcher_v3_lib::support::handlers::profile_summary::java_from_text;

#[test]
fn detects_java_from_loader_logs() {
    let forge = "[main/INFO]: Java is OpenJDK 64-Bit Server VM, version 17.0.8, running 17.0.8+7, built on x";
    let j = java_from_text(forge).unwrap();
    assert_eq!(j.version.as_deref(), Some("17.0.8"));
    assert_eq!(j.vendor.as_deref(), Some("OpenJDK 64-Bit Server VM"));

    let neo = "[main/INFO] [LAUNCHER/]: JVM identified as Microsoft OpenJDK 64-Bit Server VM 21.0.3+9-LTS";
    let j = java_from_text(neo).unwrap();
    assert_eq!(j.version.as_deref(), Some("21.0.3+9-LTS"));
    assert_eq!(
        j.vendor.as_deref(),
        Some("Microsoft OpenJDK 64-Bit Server VM")
    );

    assert!(java_from_text("[Render thread/INFO]: nothing here").is_none());
}
