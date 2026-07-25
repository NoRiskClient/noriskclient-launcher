use super::*;
use crate::state::profile_state::MemorySettings;

fn profile(min: u32, max: u32, pack: Option<&str>) -> Profile {
    let mut p: Profile = serde_json::from_value(serde_json::json!({
        "name": "test",
        "path": "test",
        "game_version": "1.20.1",
        "loader": "forge",
    }))
    .expect("profile fixture must deserialize");
    p.settings.memory = MemorySettings { min, max };
    p.selected_norisk_pack_id = pack.map(String::from);
    p
}

fn profiles(list: Vec<Profile>) -> HashMap<Uuid, Profile> {
    list.into_iter().map(|p| (p.id, p)).collect()
}

fn only(map: &HashMap<Uuid, Profile>) -> &Profile {
    map.values().next().expect("one profile")
}

/// The reason the ledger exists: a user who later picks 2 GB on purpose keeps it.
#[test]
fn once_migration_does_not_run_again() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("applied.json");

    let mut first = profiles(vec![profile(
        LEGACY_DEFAULT_MEMORY_MIN_MB,
        LEGACY_DEFAULT_MEMORY_MAX_MB,
        None,
    )]);
    migrate_profiles_with_ledger(&mut first, &ledger);
    let raised = only(&first).settings.memory.max;
    assert!(raised > LEGACY_DEFAULT_MEMORY_MAX_MB, "first run must raise");

    let mut second = profiles(vec![profile(
        LEGACY_DEFAULT_MEMORY_MIN_MB,
        LEGACY_DEFAULT_MEMORY_MAX_MB,
        None,
    )]);
    migrate_profiles_with_ledger(&mut second, &ledger);
    assert_eq!(
        only(&second).settings.memory.max,
        LEGACY_DEFAULT_MEMORY_MAX_MB,
        "a deliberate 2 GB must survive once the migration has run"
    );
}

#[test]
fn deliberate_limit_is_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("applied.json");

    let mut map = profiles(vec![profile(512, LEGACY_DEFAULT_MEMORY_MAX_MB, None)]);
    migrate_profiles_with_ledger(&mut map, &ledger);

    assert_eq!(only(&map).settings.memory.max, LEGACY_DEFAULT_MEMORY_MAX_MB);
}

/// `Always` migrations must keep firing after the ledger exists.
#[test]
fn always_migration_still_runs_with_ledger_present() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("applied.json");

    let mut first = profiles(vec![profile(1024, 4096, Some("norisk-dev"))]);
    migrate_profiles_with_ledger(&mut first, &ledger);

    let mut second = profiles(vec![profile(1024, 4096, Some("norisk-dev"))]);
    migrate_profiles_with_ledger(&mut second, &ledger);
    assert_eq!(
        only(&second).selected_norisk_pack_id.as_deref(),
        Some("norisk-prod")
    );
}

#[test]
fn corrupt_ledger_is_ignored_without_panicking() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("applied.json");
    std::fs::write(&ledger, "{ this is not json").unwrap();

    let mut map = profiles(vec![profile(
        LEGACY_DEFAULT_MEMORY_MIN_MB,
        LEGACY_DEFAULT_MEMORY_MAX_MB,
        None,
    )]);
    migrate_profiles_with_ledger(&mut map, &ledger);

    assert!(only(&map).settings.memory.max > LEGACY_DEFAULT_MEMORY_MAX_MB);
}

#[test]
fn unknown_ledger_fields_survive_a_write() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = dir.path().join("applied.json");
    std::fs::write(&ledger, r#"{"applied":[],"from_a_newer_launcher":42}"#).unwrap();

    let mut map = profiles(vec![profile(1024, 4096, None)]);
    migrate_profiles_with_ledger(&mut map, &ledger);

    let raw = std::fs::read_to_string(&ledger).unwrap();
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["from_a_newer_launcher"], 42);
    assert!(raw.contains("memory_default_2gb"));
}

/// An unwritable ledger must not stop the launcher.
#[test]
fn unwritable_ledger_does_not_panic() {
    let mut map = profiles(vec![profile(1024, 4096, None)]);
    let path = Path::new("no/such/dir/applied.json");
    migrate_profiles_with_ledger(&mut map, path);
}
