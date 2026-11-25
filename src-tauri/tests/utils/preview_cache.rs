use noriskclient_launcher_v3_lib::utils::preview_cache::{preview_cache_key, PreviewSource};

fn source(modified_ms: u128, size: u64) -> PreviewSource<'static> {
    PreviewSource { path: "C:/shots/a.png", modified_ms, size }
}

#[test]
fn the_same_file_and_size_give_the_same_key() {
    assert_eq!(preview_cache_key(&source(1, 10), 480, 270, 75), preview_cache_key(&source(1, 10), 480, 270, 75));
}

#[test]
fn a_changed_file_gets_a_new_key() {
    let base = preview_cache_key(&source(1, 10), 480, 270, 75);
    assert_ne!(base, preview_cache_key(&source(2, 10), 480, 270, 75));
    assert_ne!(base, preview_cache_key(&source(1, 11), 480, 270, 75));
}

#[test]
fn another_preview_size_or_quality_gets_a_new_key() {
    let base = preview_cache_key(&source(1, 10), 480, 270, 75);
    assert_ne!(base, preview_cache_key(&source(1, 10), 960, 540, 75));
    assert_ne!(base, preview_cache_key(&source(1, 10), 480, 270, 90));
}

#[test]
fn another_file_gets_a_new_key() {
    let other = PreviewSource { path: "C:/shots/b.png", modified_ms: 1, size: 10 };
    assert_ne!(preview_cache_key(&source(1, 10), 480, 270, 75), preview_cache_key(&other, 480, 270, 75));
}
