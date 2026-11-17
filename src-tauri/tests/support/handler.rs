use noriskclient_launcher_v3_lib::support::files::preview_excerpt;

#[test]
fn small_texts_are_previewed_in_full() {
    let (text, excerpt) = preview_excerpt("a\nb\n");
    assert_eq!(text, "a\nb\n");
    assert!(!excerpt);
}

#[test]
fn big_texts_get_first_and_last_lines() {
    let mut big = String::new();
    for i in 0..100_000 {
        big.push_str(&format!("line {:06}\n", i));
    }
    let (text, excerpt) = preview_excerpt(&big);
    assert!(excerpt);
    assert!(text.starts_with("line 000000\n"));
    assert!(text.contains("line 000199\n"));
    assert!(!text.contains("line 000200\n"));
    assert!(text.contains("line 099800\n"));
    assert!(text.ends_with("line 099999\n"));
    assert!(text.contains("preview excerpt"));
}
