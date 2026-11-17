use noriskclient_launcher_v3_lib::integrations::mod_lookup::*;

#[test]
fn duplicates_are_only_looked_up_once() {
    let chunks = chunk_unique(vec!["a", "b", "a", "c", "b"], 10);

    assert_eq!(chunks, vec![vec!["a", "b", "c"]]);
}

#[test]
fn order_of_first_appearance_is_kept() {
    let chunks = chunk_unique(vec![3, 1, 2, 1], 10);

    assert_eq!(chunks, vec![vec![3, 1, 2]]);
}

#[test]
fn a_batch_is_split_at_the_requested_size() {
    let values: Vec<u32> = (0..450).collect();

    let chunks = chunk_unique(values, MODRINTH_HASH_BATCH);

    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].len(), 200);
    assert_eq!(chunks[1].len(), 200);
    assert_eq!(chunks[2].len(), 50);
}

#[test]
fn nothing_to_look_up_means_no_requests() {
    let chunks = chunk_unique(Vec::<String>::new(), MODRINTH_HASH_BATCH);

    assert!(chunks.is_empty());
}

#[test]
fn a_zero_size_does_not_divide_by_zero() {
    let chunks = chunk_unique(vec!["a", "b"], 0);

    assert_eq!(chunks.len(), 2);
}

#[tokio::test]
async fn identifying_nothing_hits_no_network() {
    let identities = identify_jars(&[]).await;

    assert!(identities.is_empty());
}
