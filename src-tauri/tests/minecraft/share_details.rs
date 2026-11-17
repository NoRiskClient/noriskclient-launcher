use noriskclient_launcher_v3_lib::minecraft::api::share_api::ShareDetails;

fn details(json: &str) -> ShareDetails {
    serde_json::from_str(json).unwrap()
}

#[test]
fn nothing_picked_shares_with_the_server_and_the_default_expiry() {
    let picked = details("{}");
    assert_eq!(picked.title(), None);
    assert!(!picked.hide_server);
    assert_eq!(picked.expiry.days, None);
    assert!(!picked.expiry.permanent);
}

#[test]
fn the_dialog_choices_reach_the_share() {
    let picked = details(r#"{"title":"  Clutch on Hypixel  ","expiry":{"days":7},"hideServer":true}"#);
    assert_eq!(picked.title(), Some("Clutch on Hypixel"));
    assert!(picked.hide_server);
    assert_eq!(picked.expiry.days, Some(7));
}

#[test]
fn a_blank_title_falls_back_to_the_file_name() {
    assert_eq!(details(r#"{"title":"   "}"#).title(), None);
}
