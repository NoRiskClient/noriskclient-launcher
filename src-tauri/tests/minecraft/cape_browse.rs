use noriskclient_launcher_v3_lib::minecraft::api::cape_api::{legacy_next, legacy_page};

#[test]
fn a_legacy_bookmark_names_the_old_route_page() {
    assert_eq!(legacy_page("page:3"), Some(3));
}

#[test]
fn a_cursor_from_the_new_route_is_not_a_legacy_page() {
    assert_eq!(legacy_page("12:5c2f0a"), None);
    assert_eq!(legacy_page("page:soon"), None);
}

#[test]
fn the_old_route_points_to_its_next_page_until_the_last_one() {
    assert_eq!(legacy_next(0, 3), Some("page:1".to_string()));
    assert_eq!(legacy_next(2, 3), None);
    assert_eq!(legacy_next(0, 0), None);
}
