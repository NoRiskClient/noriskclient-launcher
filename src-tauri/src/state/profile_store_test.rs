use super::*;
use crate::state::db;

async fn store() -> ProfileStore {
    let handle = db::new_handle();
    db::set_pool_for_test(&handle, db::test_pool().await).await;
    ProfileStore::new(handle)
}

fn poolless_store() -> ProfileStore {
    ProfileStore::new(db::new_handle())
}

const REAL_CORPUS: &str = include_str!("../../fixtures/profile_corpus_real.json");
const SYNTHETIC_CORPUS: &str = include_str!("../../fixtures/profile_corpus_synthetic.json");

fn corpus() -> Vec<Profile> {
    let mut raw: Vec<serde_json::Value> =
        serde_json::from_str(REAL_CORPUS).expect("real corpus must parse");
    raw.extend(
        serde_json::from_str::<Vec<serde_json::Value>>(SYNTHETIC_CORPUS)
            .expect("synthetic corpus must parse"),
    );
    raw.into_iter()
        .enumerate()
        .map(|(i, value)| {
            serde_json::from_value(value)
                .unwrap_or_else(|e| panic!("corpus entry {} must deserialize: {}", i, e))
        })
        .collect()
}

fn canonical(profile: &Profile) -> serde_json::Value {
    canonical_value(profile).expect("profile must serialize")
}

fn diff(a: &serde_json::Value, b: &serde_json::Value, at: &str, out: &mut Vec<String>) {
    match (a, b) {
        (serde_json::Value::Object(x), serde_json::Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                match (x.get(key), y.get(key)) {
                    (Some(l), Some(r)) => diff(l, r, &format!("{}/{}", at, key), out),
                    (l, r) => out.push(format!("{}/{}: {:?} != {:?}", at, key, l, r)),
                }
            }
        }
        (serde_json::Value::Array(x), serde_json::Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{}: length {} != {}", at, x.len(), y.len()));
                return;
            }
            for (i, (l, r)) in x.iter().zip(y).enumerate() {
                diff(l, r, &format!("{}/{}", at, i), out);
            }
        }
        (l, r) if l != r => out.push(format!("{}: {} != {}", at, l, r)),
        _ => {}
    }
}

fn assert_lossless(before: &[Profile], after: &HashMap<Uuid, Profile>) {
    let expected: HashSet<Uuid> = before.iter().map(|p| p.id).collect();
    let actual: HashSet<Uuid> = after.keys().copied().collect();

    let missing: Vec<String> = before
        .iter()
        .filter(|p| !actual.contains(&p.id))
        .map(|p| format!("{} ({})", p.name, p.id))
        .collect();
    assert!(missing.is_empty(), "profiles vanished: {:?}", missing);
    assert_eq!(expected.len(), actual.len(), "profile count changed");

    let mut problems = Vec::new();
    for profile in before {
        let stored = &after[&profile.id];
        diff(
            &canonical(profile),
            &canonical(stored),
            &format!("/{}", profile.name),
            &mut problems,
        );
    }
    assert!(
        problems.is_empty(),
        "{} difference(s) after a database round trip:\n{}",
        problems.len(),
        problems
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[tokio::test]
async fn the_corpus_survives_a_database_round_trip() {
    let store = store().await;
    let profiles = corpus();
    assert_eq!(profiles.len(), 23, "the corpus lost entries");

    store.upsert_many(&profiles).await.expect("import must succeed");
    let loaded = store.load_all().await.expect("load must succeed");

    assert_lossless(&profiles, &loaded);
}

#[tokio::test]
async fn mod_order_survives_the_database() {
    let store = store().await;
    let mut profile = corpus()
        .into_iter()
        .find(|p| p.mods.len() >= 4)
        .expect("need a profile with several mods");

    profile.mods.reverse();
    let expected: Vec<Uuid> = profile.mods.iter().map(|m| m.id).collect();

    store.upsert_many(&[profile.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    let actual: Vec<Uuid> = loaded[&profile.id].mods.iter().map(|m| m.id).collect();
    assert_eq!(
        actual, expected,
        "rows come back in rowid order without an explicit ordinal"
    );
}

#[tokio::test]
async fn the_same_mod_id_may_live_in_two_profiles() {
    let store = store().await;
    let mut first = corpus()
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("need a profile with a mod");

    let mut second = first.clone();
    second.id = Uuid::new_v4();
    second.name = "copy".to_string();

    first.name = "original".to_string();
    let shared = first.mods[0].id;

    store.upsert_many(&[first.clone(), second.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[&first.id].mods[0].id, shared);
    assert_eq!(loaded[&second.id].mods[0].id, shared);
}

#[tokio::test]
async fn two_profiles_may_share_a_path() {
    let store = store().await;
    let mut a = corpus().remove(0);
    let mut b = a.clone();
    a.id = Uuid::new_v4();
    b.id = Uuid::new_v4();
    a.path = "noriskclient/new".to_string();
    b.path = "noriskclient/new".to_string();

    store.upsert_many(&[a, b]).await.expect("a shared path is legal");
    assert_eq!(store.counts().await.unwrap().0, 2);
}

#[tokio::test]
async fn rewriting_a_profile_does_not_lose_its_mods() {
    let store = store().await;
    let mut profile = corpus()
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("need a profile with mods");

    store.upsert_many(&[profile.clone()]).await.unwrap();
    profile.name = "renamed".to_string();
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let loaded = store.load_all().await.unwrap();
    assert_eq!(loaded[&profile.id].name, "renamed");
    assert_eq!(
        loaded[&profile.id].mods.len(),
        profile.mods.len(),
        "INSERT OR REPLACE would have cascaded the mods away"
    );
}

#[tokio::test]
async fn deleting_a_profile_takes_its_children_with_it() {
    let store = store().await;
    let profile = corpus()
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("need a profile with mods");

    store.upsert_many(&[profile.clone()]).await.unwrap();
    store.delete_profile(profile.id).await.unwrap();

    assert_eq!(store.counts().await.unwrap(), (0, 0));
}

#[tokio::test]
async fn playtime_accumulates_instead_of_overwriting() {
    let store = store().await;
    let mut profile = corpus().remove(0);
    profile.playtime_seconds = 100;
    store.upsert_many(&[profile.clone()]).await.unwrap();

    store.add_playtime(profile.id, 50).await.unwrap();
    store.add_playtime(profile.id, 25).await.unwrap();

    let loaded = store.load_all().await.unwrap();
    assert_eq!(loaded[&profile.id].playtime_seconds, 175);
}

#[tokio::test]
async fn a_playtime_beyond_i64_saturates_instead_of_wrapping() {
    let store = store().await;
    let mut profile = corpus().remove(0);
    profile.playtime_seconds = u64::MAX;

    store.upsert_many(&[profile.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    assert_eq!(
        loaded[&profile.id].playtime_seconds,
        i64::MAX as u64,
        "a plain `as i64` cast would have wrapped this to a negative"
    );
}

#[tokio::test]
async fn the_largest_exactly_storable_playtime_round_trips() {
    let store = store().await;
    let mut profile = corpus().remove(0);
    profile.playtime_seconds = i64::MAX as u64;

    store.upsert_many(&[profile.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    assert_eq!(loaded[&profile.id].playtime_seconds, i64::MAX as u64);
}

#[tokio::test]
async fn timestamps_keep_their_sub_millisecond_precision() {
    let store = store().await;
    let mut profile = corpus().remove(0);
    profile.created = DateTime::from_timestamp_nanos(1_600_000_000_123_456_789);
    profile.last_played = Some(DateTime::from_timestamp_nanos(1_700_000_000_987_654_321));

    store.upsert_many(&[profile.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    assert_eq!(loaded[&profile.id].created, profile.created);
    assert_eq!(loaded[&profile.id].last_played, profile.last_played);
}

#[tokio::test]
async fn a_store_without_a_database_refuses_to_store_profiles() {
    let store = poolless_store();

    assert!(store.load_all().await.is_err(), "reading must not look empty");
    assert!(store.upsert_many(&corpus()[..1]).await.is_err());
    assert!(store.counts().await.is_err());
}

#[tokio::test]
async fn no_database_at_all_is_an_error_not_an_empty_list() {
    let store = ProfileStore::new(db::new_handle());

    let loaded = store.load_all().await;
    assert!(
        loaded.is_err(),
        "an empty list must never be presented as truth"
    );
}

#[tokio::test]
async fn the_lookup_columns_agree_with_the_stored_source() {
    let store = store().await;
    let profiles = corpus();
    store.upsert_many(&profiles).await.unwrap();

    let pool = db::pool_of(&store.db).await.unwrap();
    let rows = sqlx::query("SELECT source, source_type, project_id FROM profile_mods")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert!(!rows.is_empty(), "the corpus must contribute mods");
    for row in rows {
        let source: crate::state::profile_state::ModSource =
            serde_json::from_str(&row.get::<String, _>("source")).unwrap();
        let (expected_type, expected_project, _, _) = source_lookup(&source);
        assert_eq!(row.get::<String, _>("source_type"), expected_type);
        assert_eq!(row.get::<Option<String>, _>("project_id"), expected_project);
    }
}

fn corpus_json() -> String {
    let mut raw: Vec<serde_json::Value> = serde_json::from_str(REAL_CORPUS).unwrap();
    raw.extend(serde_json::from_str::<Vec<serde_json::Value>>(SYNTHETIC_CORPUS).unwrap());
    serde_json::to_string(&raw).unwrap()
}

#[tokio::test]
async fn importing_the_corpus_reports_what_it_did() {
    let store = store().await;
    let outcome = store
        .import_from_json(&corpus_json())
        .await
        .expect("import must succeed");

    assert_eq!(outcome.imported, 23);
    assert_eq!(outcome.unparsed, 0);
    assert!(store.is_migrated().await.unwrap());

    let loaded = store.load_all().await.unwrap();
    assert_lossless(&corpus(), &loaded);
}

#[tokio::test]
async fn a_malformed_entry_is_quarantined_not_dropped() {
    let store = store().await;
    let raw = serde_json::json!([
        { "name": "good", "path": "g", "game_version": "1.20.1", "loader": "forge" },
        { "name": "bad", "path": "b", "game_version": "1.20.1", "loader": "LiteLoader" },
    ]);

    let outcome = store
        .import_from_json(&raw.to_string())
        .await
        .expect("one bad entry must not fail the import");

    assert_eq!(outcome.imported, 1);
    assert_eq!(outcome.unparsed, 1);

    let pool = db::pool_of(&store.db).await.unwrap();
    let kept: String = sqlx::query_scalar(
        "SELECT raw FROM profiles_legacy_import WHERE parsed = 0",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(
        kept.contains("LiteLoader"),
        "the original bytes must stay recoverable once profiles.json is gone"
    );
}

#[tokio::test]
async fn a_duplicate_id_keeps_the_last_and_escrows_the_first() {
    let store = store().await;
    let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    let raw = serde_json::json!([
        { "id": id, "name": "first", "path": "a", "game_version": "1.20.1", "loader": "forge" },
        { "id": id, "name": "second", "path": "b", "game_version": "1.20.1", "loader": "forge" },
    ]);

    let outcome = store.import_from_json(&raw.to_string()).await.unwrap();
    assert_eq!(outcome.imported, 1);
    assert_eq!(outcome.unparsed, 1, "the loser must be recorded, not silently gone");

    let loaded = store.load_all().await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(
        loaded.values().next().unwrap().name,
        "first",
        "the first id wins because the second is the duplicate"
    );
}

#[tokio::test]
async fn an_empty_file_imports_nothing_but_still_marks_the_move() {
    let store = store().await;
    let outcome = store.import_from_json("[]").await.unwrap();

    assert_eq!(outcome, ImportOutcome::default());
    assert_eq!(store.counts().await.unwrap(), (0, 0));
}

#[tokio::test]
async fn a_broken_file_leaves_the_database_untouched() {
    let store = store().await;
    assert!(store.import_from_json("not json at all").await.is_err());

    assert_eq!(store.counts().await.unwrap(), (0, 0));
    assert!(
        !store.is_migrated().await.unwrap(),
        "a failed import must not mark the migration done"
    );
}

#[tokio::test]
async fn a_later_import_drops_profiles_the_new_source_no_longer_has() {
    let store = store().await;
    let full: Vec<serde_json::Value> = serde_json::from_str(&corpus_json()).unwrap();
    assert!(full.len() > 2, "the corpus must be big enough to shrink");

    store
        .import_from_json(&serde_json::to_string(&full).unwrap())
        .await
        .unwrap();

    let survivor = full[0].clone();
    let survivor_id = survivor["id"].as_str().unwrap().to_string();
    store
        .import_from_json(&serde_json::to_string(&vec![survivor]).unwrap())
        .await
        .unwrap();

    let loaded = store.load_all().await.unwrap();
    assert_eq!(
        loaded.len(),
        1,
        "restoring a smaller backup must remove the profiles it does not contain"
    );
    assert!(loaded.contains_key(&Uuid::parse_str(&survivor_id).unwrap()));
}

#[tokio::test]
async fn a_later_import_drops_mods_the_new_source_no_longer_has() {
    let store = store().await;
    let full: Vec<serde_json::Value> = serde_json::from_str(&corpus_json()).unwrap();

    let mut with_mods = full
        .iter()
        .find(|value| value["mods"].as_array().map_or(0, |m| m.len()) > 1)
        .expect("the corpus must hold a profile with several mods")
        .clone();

    store
        .import_from_json(&serde_json::to_string(&vec![with_mods.clone()]).unwrap())
        .await
        .unwrap();
    let (_, before) = store.counts().await.unwrap();
    assert!(before > 1);

    with_mods["mods"] = serde_json::Value::Array(Vec::new());
    store
        .import_from_json(&serde_json::to_string(&vec![with_mods]).unwrap())
        .await
        .unwrap();

    assert_eq!(
        store.counts().await.unwrap().1,
        0,
        "mod rows must not outlive the profile version that owned them"
    );
}

#[tokio::test]
async fn a_failed_second_import_leaves_the_first_one_standing() {
    let store = store().await;
    store.import_from_json(&corpus_json()).await.unwrap();
    let before = store.counts().await.unwrap();

    assert!(store.import_from_json("[{\"id\": ").await.is_err());

    assert_eq!(
        store.counts().await.unwrap(),
        before,
        "a rejected restore must not empty the database it failed to replace"
    );
}

#[tokio::test]
async fn importing_twice_does_not_duplicate_anything() {
    let store = store().await;
    let json = corpus_json();

    store.import_from_json(&json).await.unwrap();
    let first = store.counts().await.unwrap();
    store.import_from_json(&json).await.unwrap();

    assert_eq!(
        store.counts().await.unwrap(),
        first,
        "a second import must not append mod rows"
    );
}

#[tokio::test]
async fn a_store_without_a_database_refuses_to_import() {
    let store = poolless_store();
    assert!(store.import_from_json("[]").await.is_err());
}

#[tokio::test]
async fn a_targeted_toggle_lands_in_the_database() {
    let store = store().await;
    let profile = corpus()
        .into_iter()
        .find(|p| p.mods.len() >= 2)
        .expect("the corpus must hold a profile with two mods");
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let target = profile.mods[0].id;
    let before = profile.mods[0].enabled;
    store
        .set_mods_enabled(profile.id, &[target], !before)
        .await
        .unwrap();

    let loaded = &store.load_all().await.unwrap()[&profile.id];
    let flipped = loaded.mods.iter().find(|m| m.id == target).unwrap();
    assert_eq!(flipped.enabled, !before);

    let untouched = loaded.mods.iter().find(|m| m.id == profile.mods[1].id).unwrap();
    assert_eq!(
        untouched.enabled, profile.mods[1].enabled,
        "a targeted write must not disturb its neighbours"
    );
}

#[tokio::test]
async fn a_targeted_delete_keeps_the_order_of_what_is_left() {
    let store = store().await;
    let profile = corpus()
        .into_iter()
        .find(|p| p.mods.len() >= 3)
        .expect("the corpus must hold a profile with three mods");
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let removed = profile.mods[1].id;
    let expected: Vec<Uuid> = profile
        .mods
        .iter()
        .map(|m| m.id)
        .filter(|id| *id != removed)
        .collect();

    assert_eq!(store.delete_mods(profile.id, &[removed]).await.unwrap(), 1);

    let loaded = &store.load_all().await.unwrap()[&profile.id];
    let actual: Vec<Uuid> = loaded.mods.iter().map(|m| m.id).collect();
    assert_eq!(
        actual, expected,
        "deleting from the middle must leave the survivors in their original order"
    );
}

#[tokio::test]
async fn a_targeted_write_never_reaches_another_profile() {
    let store = store().await;
    let mut corpus = corpus();
    let mut first = corpus.remove(0);
    let second = corpus
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("a second profile with mods");
    first.mods = second.mods.clone();
    store.upsert_many(&[first.clone(), second.clone()]).await.unwrap();

    let shared = second.mods[0].id;
    store.set_mods_enabled(second.id, &[shared], false).await.unwrap();
    store.delete_mods(second.id, &[shared]).await.unwrap();

    let loaded = store.load_all().await.unwrap();
    assert!(
        loaded[&first.id].mods.iter().any(|m| m.id == shared),
        "the same mod id in another profile must survive"
    );
    assert!(!loaded[&second.id].mods.iter().any(|m| m.id == shared));
    assert_eq!(
        loaded[&first.id].mods.len(),
        first.mods.len(),
        "the untouched profile must keep every one of its mods"
    );
}

#[tokio::test]
async fn norisk_statuses_are_written_one_row_at_a_time() {
    let store = store().await;
    let mut profile = corpus().into_iter().next().unwrap();
    profile.disabled_norisk_mods_detailed.clear();
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let identifier = NoriskModIdentifier {
        pack_id: "pack-1".to_string(),
        mod_id: "some-mod".to_string(),
        game_version: "1.21.1".to_string(),
        loader: ModLoader::Fabric,
    };

    store
        .set_norisk_mod_statuses(profile.id, &[(identifier.clone(), false)])
        .await
        .unwrap();
    assert!(store.load_all().await.unwrap()[&profile.id]
        .disabled_norisk_mods_detailed
        .contains(&identifier));

    store
        .set_norisk_mod_statuses(profile.id, &[(identifier.clone(), true)])
        .await
        .unwrap();
    assert!(store.load_all().await.unwrap()[&profile.id]
        .disabled_norisk_mods_detailed
        .is_empty());
}

#[tokio::test]
async fn a_targeted_write_past_the_sql_variable_limit_still_lands() {
    let store = store().await;
    let mut profile = corpus().into_iter().next().unwrap();
    let template = profile
        .mods
        .first()
        .cloned()
        .unwrap_or_else(|| corpus().into_iter().find_map(|p| p.mods.first().cloned()).unwrap());

    profile.mods = (0..SQL_VARIABLE_CHUNK + 50)
        .map(|_| {
            let mut entry = template.clone();
            entry.id = Uuid::new_v4();
            entry.enabled = true;
            entry
        })
        .collect();
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let ids: Vec<Uuid> = profile.mods.iter().map(|m| m.id).collect();
    let changed = store.set_mods_enabled(profile.id, &ids, false).await.unwrap();
    assert_eq!(changed as usize, ids.len(), "every chunk must be applied");

    let loaded = &store.load_all().await.unwrap()[&profile.id];
    assert!(loaded.mods.iter().all(|m| !m.enabled));
}

#[tokio::test]
async fn sync_pack_subscriptions_survive_the_database() {
    let store = store().await;
    let mut profile = corpus().into_iter().next().unwrap();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    profile.sync_pack_ids = vec![a, b];

    store.upsert_many(&[profile.clone()]).await.unwrap();
    let loaded = store.load_all().await.unwrap();

    assert_eq!(
        loaded[&profile.id].sync_pack_ids,
        vec![a, b],
        "subscription order is what the UI renders"
    );
}

#[tokio::test]
async fn dropping_a_subscription_removes_only_that_row() {
    let store = store().await;
    let mut profile = corpus().into_iter().next().unwrap();
    let keep = Uuid::new_v4();
    let drop = Uuid::new_v4();
    profile.sync_pack_ids = vec![keep, drop];
    store.upsert_many(&[profile.clone()]).await.unwrap();

    profile.sync_pack_ids = vec![keep];
    store.upsert_many(&[profile.clone()]).await.unwrap();

    assert_eq!(
        store.load_all().await.unwrap()[&profile.id].sync_pack_ids,
        vec![keep]
    );
}

#[tokio::test]
async fn deleting_a_profile_drops_its_subscriptions() {
    let store = store().await;
    let mut profile = corpus().into_iter().next().unwrap();
    profile.sync_pack_ids = vec![Uuid::new_v4()];
    store.upsert_many(&[profile.clone()]).await.unwrap();

    store.delete_profile(profile.id).await.unwrap();

    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_sync_packs")
        .fetch_one(&db::pool_of(&store.db).await.unwrap())
        .await
        .unwrap();
    assert_eq!(left, 0, "the cascade must take the links with it");
}

#[tokio::test]
async fn upserting_one_mod_leaves_its_neighbours_alone() {
    let store = store().await;
    let profile = corpus()
        .into_iter()
        .find(|p| p.mods.len() >= 3)
        .expect("a profile with three mods");
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let mut changed = profile.mods[1].clone();
    changed.display_name = Some("renamed by a targeted write".to_string());
    changed.enabled = !changed.enabled;
    store.upsert_mods(profile.id, &[(1, changed.clone())]).await.unwrap();

    let loaded = &store.load_all().await.unwrap()[&profile.id];
    assert_eq!(
        loaded.mods.iter().map(|m| m.id).collect::<Vec<_>>(),
        profile.mods.iter().map(|m| m.id).collect::<Vec<_>>(),
        "order must survive a targeted write"
    );
    assert_eq!(loaded.mods[1].display_name, changed.display_name);
    assert_eq!(loaded.mods[1].enabled, changed.enabled);
    assert_eq!(loaded.mods[0].display_name, profile.mods[0].display_name);
    assert_eq!(loaded.mods[2].display_name, profile.mods[2].display_name);
}

#[tokio::test]
async fn upserting_an_unknown_mod_appends_it_without_touching_the_rest() {
    let store = store().await;
    let profile = corpus()
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("a profile with mods");
    store.upsert_many(&[profile.clone()]).await.unwrap();

    let mut fresh = profile.mods[0].clone();
    fresh.id = Uuid::new_v4();
    let at = profile.mods.len();
    store.upsert_mods(profile.id, &[(at, fresh.clone())]).await.unwrap();

    let loaded = &store.load_all().await.unwrap()[&profile.id];
    assert_eq!(loaded.mods.len(), profile.mods.len() + 1);
    assert_eq!(loaded.mods.last().unwrap().id, fresh.id, "a new mod lands at its ordinal");
}

#[tokio::test]
async fn a_targeted_mod_write_never_reaches_another_profile() {
    let store = store().await;
    let mut corpus = corpus();
    let first = corpus.remove(0);
    let mut second = corpus
        .into_iter()
        .find(|p| !p.mods.is_empty())
        .expect("a second profile with mods");
    second.mods = first.mods.clone();
    store.upsert_many(&[first.clone(), second.clone()]).await.unwrap();

    let mut changed = first.mods[0].clone();
    changed.display_name = Some("only here".to_string());
    store.upsert_mods(first.id, &[(0, changed)]).await.unwrap();

    let loaded = store.load_all().await.unwrap();
    assert_eq!(
        loaded[&second.id].mods[0].display_name,
        second.mods[0].display_name,
        "the same mod id in another profile must be untouched"
    );
}

const FIXTURE_ENV: &str = "NRC_PROFILES_FIXTURE";

fn is_profiles_json(name: &str) -> bool {
    name == "profiles.json" || name == "profiles.json.migrated"
}

fn fixture_files() -> Vec<std::path::PathBuf> {
    let Ok(raw) = std::env::var(FIXTURE_ENV) else {
        eprintln!(
            "set {} to a profiles.json or a directory of them to run this",
            FIXTURE_ENV
        );
        return Vec::new();
    };

    let path = std::path::PathBuf::from(raw);
    if path.is_file() {
        return vec![path];
    }

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&path)
        .unwrap_or_else(|e| panic!("cannot read {:?}: {}", path, e))
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            !name.ends_with(".backup.meta")
                && (is_profiles_json(name) || name.ends_with(".backup"))
        })
        .collect();
    files.sort();
    files
}

struct Report {
    profiles: usize,
    mods: usize,
    skipped: usize,
    dropped_by_serde: Vec<String>,
}

async fn round_trip_file(content: &str) -> Report {
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(content).expect("the file must be a JSON array");

    let mut before = Vec::new();
    let mut skipped = 0;
    let mut dropped = std::collections::BTreeSet::new();

    for value in &entries {
        match serde_json::from_value::<Profile>(value.clone()) {
            Ok(profile) => {
                if let (Some(source), Ok(serde_json::Value::Object(kept))) =
                    (value.as_object(), serde_json::to_value(&profile))
                {
                    for key in source.keys() {
                        if !kept.contains_key(key) {
                            dropped.insert(key.clone());
                        }
                    }
                }
                before.push(profile);
            }
            Err(_) => skipped += 1,
        }
    }

    let store = store().await;
    store.upsert_many(&before).await.expect("import must succeed");
    let after = store.load_all().await.expect("load must succeed");

    assert_lossless(&before, &after);

    Report {
        profiles: before.len(),
        mods: before.iter().map(|p| p.mods.len()).sum(),
        skipped,
        dropped_by_serde: dropped.into_iter().collect(),
    }
}

#[tokio::test]
#[ignore]
async fn real_profiles_round_trip_without_loss() {
    let files = fixture_files();
    if files.is_empty() {
        return;
    }

    let mut failures = Vec::new();
    for file in &files {
        let content = std::fs::read_to_string(file).expect("fixture must be readable");
        let name = file.file_name().unwrap().to_string_lossy();

        let started = std::time::Instant::now();
        match tokio::task::spawn(async move { round_trip_file(&content).await }).await {
            Ok(report) => println!(
                "  ok   {:<52} profiles={:<5} mods={:<7} skipped={} {}ms{}",
                name,
                report.profiles,
                report.mods,
                report.skipped,
                started.elapsed().as_millis(),
                if report.dropped_by_serde.is_empty() {
                    String::new()
                } else {
                    format!("  serde already drops: {:?}", report.dropped_by_serde)
                }
            ),
            Err(e) => {
                println!("  FAIL {:<52} {}", name, e);
                failures.push(name.to_string());
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} file(s) did not round trip: {:?}",
        failures.len(),
        files.len(),
        failures
    );
}

fn real_profiles_file() -> Option<std::path::PathBuf> {
    fixture_files().into_iter().find(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .map_or(false, is_profiles_json)
    })
}

#[tokio::test]
#[ignore]
async fn real_profiles_migrate_through_the_production_import() {
    let Some(file) = real_profiles_file() else {
        return;
    };

    let content = std::fs::read_to_string(&file).unwrap();
    let entries: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap();
    let expected: Vec<Profile> = entries
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");
    let handle = db::new_handle();
    db::open_at_for_test(&handle, &path).await;
    let store = ProfileStore::new(handle);

    assert!(!store.is_migrated().await.unwrap());

    let started = std::time::Instant::now();
    let outcome = store
        .import_from_json(&content)
        .await
        .expect("the production import must succeed on real data");
    let import_ms = started.elapsed().as_millis();

    assert_eq!(outcome.imported, expected.len());
    assert_eq!(outcome.unparsed, entries.len() - expected.len());
    assert!(store.is_migrated().await.unwrap());

    let escrowed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles_legacy_import")
        .fetch_one(&store.pool().await.unwrap())
        .await
        .unwrap();
    assert_eq!(
        escrowed,
        entries.len() as i64,
        "every source entry must be escrowed byte for byte"
    );

    let reopened = db::new_handle();
    db::open_at_for_test(&reopened, &path).await;
    let after = ProfileStore::new(reopened).load_all().await.unwrap();
    assert_lossless(&expected, &after);

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!(
        "  imported {} profiles / {} mods in {}ms, {} quarantined, app.db is {:.1} MB",
        outcome.imported,
        outcome.mods,
        import_ms,
        outcome.unparsed,
        bytes as f64 / 1024.0 / 1024.0
    );
}

#[tokio::test]
#[ignore]
async fn real_profiles_survive_a_file_backed_database() {
    let Some(file) = real_profiles_file() else {
        return;
    };

    let content = std::fs::read_to_string(&file).unwrap();
    let entries: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap();
    let before: Vec<Profile> = entries
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");

    let handle = db::new_handle();
    db::open_at_for_test(&handle, &path).await;
    let store = ProfileStore::new(handle);

    let started = std::time::Instant::now();
    store.upsert_many(&before).await.expect("import must succeed");
    let write_ms = started.elapsed().as_millis();

    let reopened = db::new_handle();
    db::open_at_for_test(&reopened, &path).await;
    let after = ProfileStore::new(reopened).load_all().await.unwrap();

    assert_lossless(&before, &after);

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!(
        "  {} profiles written in {}ms, app.db is {:.1} MB",
        before.len(),
        write_ms,
        bytes as f64 / 1024.0 / 1024.0
    );
}

#[tokio::test]
async fn a_fresh_database_is_not_marked_as_migrated() {
    let store = store().await;
    assert!(!store.is_migrated().await.unwrap());
}

#[tokio::test]
async fn the_marker_only_appears_after_a_successful_commit() {
    let store = store().await;

    assert!(store.import_from_json("[").await.is_err());
    assert!(
        !store.is_migrated().await.unwrap(),
        "a rolled back import must leave the marker unset so the next start retries"
    );

    store.import_from_json("[]").await.unwrap();
    assert!(store.is_migrated().await.unwrap());
}

#[tokio::test]
async fn a_failing_verification_rolls_the_whole_import_back() {
    let store = store().await;
    let mut profile = corpus().remove(0);
    profile.id = Uuid::nil();

    let raw = serde_json::to_string(&vec![
        serde_json::to_value(&profile).unwrap(),
        serde_json::json!({ "name": "x", "path": "x", "game_version": "1.20.1", "loader": "bogus" }),
    ])
    .unwrap();

    store.import_from_json(&raw).await.unwrap();
    let (profiles, _) = store.counts().await.unwrap();
    assert_eq!(profiles, 1, "the good entry lands, the bad one is quarantined");
}

#[tokio::test]
async fn quarantined_entries_can_be_read_back_out() {
    let store = store().await;
    let raw = serde_json::json!([
        { "name": "bad", "path": "b", "game_version": "1.20.1", "loader": "LiteLoader" },
    ]);
    store.import_from_json(&raw.to_string()).await.unwrap();

    let pool = db::pool_of(&store.db).await.unwrap();
    let rows = sqlx::query("SELECT raw, parse_error FROM profiles_legacy_import WHERE parsed = 0")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert_eq!(rows.len(), 1);
    let recovered: serde_json::Value =
        serde_json::from_str(&rows[0].get::<String, _>("raw")).unwrap();
    assert_eq!(recovered["name"], "bad");
    let reason = rows[0].get::<Option<String>, _>("parse_error").unwrap();
    assert!(
        reason.contains("LiteLoader"),
        "the recorded reason must name the offending value, got: {}",
        reason
    );
}

#[tokio::test]
async fn every_source_entry_is_escrowed() {
    let store = store().await;
    store.import_from_json(&corpus_json()).await.unwrap();

    let pool = db::pool_of(&store.db).await.unwrap();
    let escrowed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles_legacy_import")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(escrowed, 23, "the escrow must hold every entry, not just the good ones");
}

#[tokio::test]
#[ignore]
async fn real_profiles_read_through_cost() {
    let Some(file) = real_profiles_file() else {
        return;
    };

    let content = std::fs::read_to_string(&file).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");
    let handle = db::new_handle();
    db::open_at_for_test(&handle, &path).await;
    let store = ProfileStore::new(handle);
    store.import_from_json(&content).await.unwrap();

    let reopened = db::new_handle();
    db::open_at_for_test(&reopened, &path).await;
    let store = ProfileStore::new(reopened);
    let pool = store.pool().await.unwrap();

    let started = std::time::Instant::now();
    let map = store.load_all().await.unwrap();
    println!("  load_all: {} profiles in {}ms", map.len(), started.elapsed().as_millis());

    let mut by_mods: Vec<(usize, Uuid)> =
        map.iter().map(|(id, p)| (p.mods.len(), *id)).collect();
    by_mods.sort();
    let median = by_mods[by_mods.len() / 2];
    let biggest = *by_mods.last().unwrap();

    async fn read_one(pool: &sqlx::SqlitePool, id: Uuid) -> Profile {
        let row = sqlx::query("SELECT * FROM profiles WHERE id = ?1")
            .bind(id.to_string())
            .fetch_one(pool)
            .await
            .unwrap();
        let mut profile = row_to_profile(&row).unwrap();
        for row in sqlx::query("SELECT * FROM profile_mods WHERE profile_id = ?1 ORDER BY ordinal")
            .bind(id.to_string())
            .fetch_all(pool)
            .await
            .unwrap()
        {
            profile.mods.push(row_to_mod(&row).unwrap().1);
        }
        for row in sqlx::query("SELECT * FROM profile_disabled_norisk_mods WHERE profile_id = ?1")
            .bind(id.to_string())
            .fetch_all(pool)
            .await
            .unwrap()
        {
            profile.disabled_norisk_mods_detailed.insert(row_to_disabled(&row).unwrap().1);
        }
        profile
    }

    let started = std::time::Instant::now();
    for _ in 0..5 {
        let all: Vec<Profile> = map.values().cloned().collect();
        std::hint::black_box(all);
    }
    println!("  list_profiles today (map clone of all):      {}ms", started.elapsed().as_millis() / 5);

    let started = std::time::Instant::now();
    for _ in 0..5 {
        let all: Vec<Profile> = map.values().cloned().collect();
        std::hint::black_box(serde_json::to_string(&all).unwrap());
    }
    println!("  list_profiles today + JSON to frontend:      {}ms", started.elapsed().as_millis() / 5);

    let started = std::time::Instant::now();
    for _ in 0..5 {
        std::hint::black_box(store.load_all().await.unwrap());
    }
    println!("  list_profiles under read-through (load_all): {}ms", started.elapsed().as_millis() / 5);

    let started = std::time::Instant::now();
    for _ in 0..5 {
        let slim: Vec<Profile> = map
            .values()
            .cloned()
            .map(|mut p| {
                p.mods = Vec::new();
                p
            })
            .collect();
        std::hint::black_box(serde_json::to_string(&slim).unwrap());
    }
    println!("  what the UI really does today (clone all, strip mods, JSON): {}ms", started.elapsed().as_millis() / 5);

    let started = std::time::Instant::now();
    for _ in 0..5 {
        let slim: Vec<(Profile, usize)> = map
            .values()
            .map(|p| {
                let slim = Profile {
                    mods: Vec::new(),
                    sync_pack_ids: p.sync_pack_ids.clone(),
                    name: p.name.clone(),
                    path: p.path.clone(),
                    game_version: p.game_version.clone(),
                    loader: p.loader.clone(),
                    loader_version: p.loader_version.clone(),
                    settings: p.settings.clone(),
                    state: p.state.clone(),
                    selected_norisk_pack_id: p.selected_norisk_pack_id.clone(),
                    disabled_norisk_mods_detailed: p.disabled_norisk_mods_detailed.clone(),
                    group: p.group.clone(),
                    description: p.description.clone(),
                    banner: p.banner.clone(),
                    background: p.background.clone(),
                    norisk_information: p.norisk_information.clone(),
                    modpack_info: p.modpack_info.clone(),
                    extra: p.extra.clone(),
                    ..*p
                };
                (slim, p.mods.len())
            })
            .collect();
        let just_profiles: Vec<&Profile> = slim.iter().map(|(p, _)| p).collect();
        std::hint::black_box(serde_json::to_string(&just_profiles).unwrap());
    }
    println!("  new slim list path (no mod clone) + JSON:     {}ms", started.elapsed().as_millis() / 5);

    let started = std::time::Instant::now();
    for _ in 0..5 {
        let rows = sqlx::query("SELECT * FROM profiles").fetch_all(&pool).await.unwrap();
        let metas: Vec<Profile> = rows.iter().map(|r| row_to_profile(r).unwrap()).collect();
        std::hint::black_box(serde_json::to_string(&metas).unwrap());
    }
    println!("  same list straight from SQL, mods never read: {}ms", started.elapsed().as_millis() / 5);

    for (label, (mods, id)) in [("median", median), ("biggest", biggest)] {
        let mut profile = map.get(&id).cloned().unwrap();
        let started = std::time::Instant::now();
        for i in 0..10 {
            if let Some(entry) = profile.mods.first_mut() {
                entry.enabled = i % 2 == 0;
            }
            store.upsert_many(std::slice::from_ref(&profile)).await.unwrap();
        }
        println!(
            "  toggle one mod, {:<8} {:>4} mods | whole-profile rewrite {:>6}us",
            label,
            mods,
            started.elapsed().as_micros() / 10
        );

        let started = std::time::Instant::now();
        for i in 0..10 {
            let target = profile.mods.first().map(|m| m.id.to_string()).unwrap_or_default();
            sqlx::query("UPDATE profile_mods SET enabled = ?3 WHERE profile_id = ?1 AND id = ?2")
                .bind(id.to_string())
                .bind(&target)
                .bind(i % 2)
                .execute(&pool)
                .await
                .unwrap();
        }
        println!(
            "  toggle one mod, {:<8} {:>4} mods | targeted UPDATE      {:>6}us",
            label,
            mods,
            started.elapsed().as_micros() / 10
        );
    }

    for (label, (mods, id)) in [("median", median), ("biggest", biggest)] {
        let started = std::time::Instant::now();
        for _ in 0..50 {
            let p = read_one(&pool, id).await;
            std::hint::black_box(p);
        }
        let full_us = started.elapsed().as_micros() / 50;

        let started = std::time::Instant::now();
        for _ in 0..50 {
            let row = sqlx::query("SELECT * FROM profiles WHERE id = ?1")
                .bind(id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
            std::hint::black_box(row_to_profile(&row).unwrap());
        }
        let meta_us = started.elapsed().as_micros() / 50;

        let started = std::time::Instant::now();
        for _ in 0..50 {
            std::hint::black_box(map.get(&id).cloned().unwrap());
        }
        let clone_us = started.elapsed().as_micros() / 50;

        println!(
            "  {:<8} {:>5} mods | full read {:>7}us | meta only {:>6}us | HashMap clone {:>6}us",
            label, mods, full_us, meta_us, clone_us
        );
    }
}

#[tokio::test]
#[ignore]
async fn export_profiles_to_json() {
    let (Ok(source), Ok(out)) = (
        std::env::var("NRC_EXPORT_DB"),
        std::env::var("NRC_EXPORT_OUT"),
    ) else {
        eprintln!("set NRC_EXPORT_DB and NRC_EXPORT_OUT to run this");
        return;
    };

    let handle = db::new_handle();
    db::open_at_for_test(&handle, std::path::Path::new(&source)).await;
    let store = ProfileStore::new(handle);

    let (profiles, mods) = store.counts().await.unwrap();
    let map = store.load_all().await.unwrap();

    assert_eq!(map.len() as i64, profiles, "every profile row must load");
    let loaded_mods: i64 = map.values().map(|p| p.mods.len() as i64).sum();
    assert_eq!(loaded_mods, mods, "every mod row must load");

    let mut list: Vec<&Profile> = map.values().collect();
    list.sort_by_key(|p| p.id);

    std::fs::write(&out, serde_json::to_string_pretty(&list).unwrap()).unwrap();
    println!(
        "  exported {} profiles / {} mods to {}",
        profiles, mods, out
    );
}
