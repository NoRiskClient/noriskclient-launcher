use noriskclient_launcher_v3_lib::minecraft::{
    default_jvm_args, is_allowed_jvm_flag, parse_jvm_rules, plan_jvm_rules, sets_gc, JvmContext,
    JvmPlan, DEFAULT_GC_ARGS,
};
use serde_json::{json, Value};
use uuid::Uuid;

fn context() -> JvmContext {
    JvmContext {
        java_major: 21,
        minecraft: "1.21.11".to_string(),
        loader: "fabric".to_string(),
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
        ram_mb: 32768,
        heap_mb: 6144,
        user_gc: false,
        player: Some(Uuid::from_u128(7)),
    }
}

fn plan(rules: Value, ctx: &JvmContext) -> JvmPlan {
    plan_jvm_rules(&parse_jvm_rules(&rules), ctx)
}

fn applied(when: Value, ctx: &JvmContext) -> bool {
    !plan(json!([{ "id": "r", "when": when, "args": ["-XX:+UseStringDeduplication"] }]), ctx)
        .applied
        .is_empty()
}

#[test]
fn a_matching_rule_adds_its_flags_after_the_unlock_flags() {
    let plan = plan(
        json!([{ "id": "zgc", "when": { "java": ">=21" }, "args": ["-XX:+UseZGC", "-XX:+ZGenerational"] }]),
        &context(),
    );

    assert_eq!(
        plan.jvm_args(),
        vec![
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+UnlockDiagnosticVMOptions",
            "-XX:+UseZGC",
            "-XX:+ZGenerational",
        ],
    );
    assert_eq!(plan.applied, vec!["zgc"]);
}

#[test]
fn system_properties_alone_need_no_unlock_flags() {
    let plan = plan(json!([{ "id": "debug", "args": ["-Dnorisk.debug=true"] }]), &context());

    assert_eq!(plan.jvm_args(), vec!["-Dnorisk.debug=true"]);
}

#[test]
fn no_matching_rule_changes_nothing() {
    let plan = plan(json!([{ "id": "j25", "when": { "java": ">=25" }, "args": ["-XX:+UseCompactObjectHeaders"] }]), &context());

    assert!(plan.jvm_args().is_empty());
    assert!(plan.applied.is_empty());
}

#[test]
fn a_rule_without_conditions_always_applies() {
    assert!(applied(json!({}), &context()));
}

#[test]
fn version_ranges_combine_with_spaces() {
    let when = json!({ "java": ">=21 <25", "mc": ">=1.20.5 <26" });

    assert!(applied(when.clone(), &context()));
    assert!(!applied(when.clone(), &JvmContext { java_major: 25, ..context() }));
    assert!(!applied(when, &JvmContext { minecraft: "1.20.4".into(), ..context() }));
}

#[test]
fn list_conditions_match_any_entry() {
    let when = json!({ "os": ["windows", "linux"], "loader": ["fabric"], "arch": ["x86_64"] });

    assert!(applied(when.clone(), &context()));
    assert!(!applied(when.clone(), &JvmContext { os: "macos".into(), ..context() }));
    assert!(!applied(when, &JvmContext { loader: "forge".into(), ..context() }));
}

#[test]
fn memory_conditions_use_the_machine_and_the_profile_heap() {
    let when = json!({ "ramMb": ">=16384", "heapMb": ">=4096" });

    assert!(applied(when.clone(), &context()));
    assert!(!applied(when.clone(), &JvmContext { ram_mb: 8192, ..context() }));
    assert!(!applied(when, &JvmContext { heap_mb: 2048, ..context() }));
}

#[test]
fn every_matching_rule_applies_without_duplicate_flags() {
    let plan = plan(
        json!([
            { "id": "dedup", "args": ["-XX:+UseStringDeduplication"] },
            { "id": "zgc", "args": ["-XX:+UseZGC", "-XX:+UseStringDeduplication"] }
        ]),
        &context(),
    );

    assert_eq!(plan.applied, vec!["dedup", "zgc"]);
    assert_eq!(plan.args, vec!["-XX:+UseStringDeduplication", "-XX:+UseZGC"]);
}

#[test]
fn a_gc_the_user_picked_is_never_replaced() {
    let ctx = JvmContext { user_gc: true, ..context() };
    let plan = plan(json!([{ "id": "zgc", "args": ["-XX:+UseZGC", "-XX:+UseStringDeduplication"] }]), &ctx);

    assert_eq!(plan.args, vec!["-XX:+UseStringDeduplication"]);
}

#[test]
fn rollout_is_stable_per_player_and_needs_a_player() {
    let enrolled = (0..200u128)
        .filter(|n| applied(json!({ "rollout": 50 }), &JvmContext { player: Some(Uuid::from_u128(*n)), ..context() }))
        .count();

    assert!((60..140).contains(&enrolled), "{enrolled} of 200 players enrolled");
    for n in 0..20u128 {
        let ctx = JvmContext { player: Some(Uuid::from_u128(n)), ..context() };
        assert_eq!(applied(json!({ "rollout": 50 }), &ctx), applied(json!({ "rollout": 50 }), &ctx));
    }
    assert!(!applied(json!({ "rollout": 100 }), &JvmContext { player: None, ..context() }));
}

#[test]
fn rules_with_dangerous_or_unknown_content_are_dropped_alone() {
    let rules = parse_jvm_rules(&json!([
        { "id": "agent", "args": ["-javaagent:evil.jar"] },
        { "id": "on-error", "args": ["-XX:OnError=calc.exe"] },
        { "id": "typo", "wen": { "java": ">=21" }, "args": ["-XX:+UseZGC"] },
        { "id": "bad-range", "when": { "java": "twenty" }, "args": ["-XX:+UseZGC"] },
        { "id": "bad-rollout", "when": { "rollout": 150 }, "args": ["-XX:+UseZGC"] },
        { "args": ["-XX:+UseZGC"] },
        "not a rule",
        { "id": "fine", "args": ["-XX:+UseStringDeduplication"] }
    ]));

    assert_eq!(plan_jvm_rules(&rules, &context()).applied, vec!["fine"]);
}

#[test]
fn missing_or_malformed_rule_lists_give_no_rules() {
    assert!(parse_jvm_rules(&Value::Null).is_empty());
    assert!(parse_jvm_rules(&json!({ "id": "x" })).is_empty());
}

#[test]
fn only_plain_tuning_flags_are_allowed() {
    for flag in [
        "-XX:+UseZGC",
        "-XX:-UseBASE64Intrinsics",
        "-XX:MaxGCPauseMillis=50",
        "-XX:G1HeapRegionSize=32M",
        "-Dsodium.checks.issue2561=false",
        "-Dnorisk.experimentalRenderer=true",
        "-Dnrc.debug=1",
    ] {
        assert!(is_allowed_jvm_flag(flag), "{flag} should be allowed");
    }
    for flag in [
        "-javaagent:x.jar",
        "-agentpath:/tmp/x.so",
        "-Xbootclasspath/a:x.jar",
        "-Xlog:gc:file=/tmp/x",
        "-XX:OnError=calc.exe",
        "-XX:OnOutOfMemoryError=cmd /c del",
        "-XX:HeapDumpPath=/tmp",
        "-XX:+UseZGC extra",
        "-Djava.system.class.loader=Evil",
        "-Djava.security.manager=allow",
        "-Dlog4j2.configurationFile=x",
        "-Dfabric.addMods=x",
        "-Dnorisk.token=stolen",
        "-Dsome.path=C:\\Windows",
        "-Dsome.url=https://x",
        "-Xmx99G",
        "-cp",
        "",
    ] {
        assert!(!is_allowed_jvm_flag(flag), "{flag} should be refused");
    }
}

#[test]
fn gc_flags_are_recognised_in_any_argument_list() {
    assert!(sets_gc(["-Xss2M", "-XX:+UseZGC"]));
    assert!(sets_gc(["-XX:+UseShenandoahGC"]));
    assert!(!sets_gc(["-Xss2M", "-XX:+UseStringDeduplication"]));
}

#[test]
fn defaults_without_pack_rules_are_the_launcher_gc_flags() {
    assert_eq!(
        default_jvm_args(&JvmPlan::default()),
        DEFAULT_GC_ARGS.map(String::from).to_vec()
    );
}

#[test]
fn a_pack_gc_replaces_the_launcher_gc_in_the_defaults() {
    let plan = plan(
        json!([{ "id": "zgc", "args": ["-XX:+UseZGC", "-XX:+UseStringDeduplication"] }]),
        &context(),
    );

    assert_eq!(
        default_jvm_args(&plan),
        vec![
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+UnlockDiagnosticVMOptions",
            "-XX:+UseZGC",
            "-XX:+UseStringDeduplication",
        ],
    );
}

#[test]
fn pack_flags_without_a_gc_join_the_launcher_gc_once() {
    let plan = plan(
        json!([{ "id": "dedup", "args": ["-XX:+UseStringDeduplication", "-Dnorisk.debug=true"] }]),
        &context(),
    );
    let args = default_jvm_args(&plan);

    assert!(args.contains(&"-XX:+UseG1GC".to_string()));
    assert!(args.ends_with(&[
        "-XX:+UseStringDeduplication".to_string(),
        "-Dnorisk.debug=true".to_string()
    ]));
    assert_eq!(
        args.iter()
            .filter(|arg| *arg == "-XX:+UnlockExperimentalVMOptions")
            .count(),
        1
    );
}
