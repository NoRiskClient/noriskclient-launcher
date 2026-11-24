use noriskclient_launcher_v3_lib::ads::policy::*;
use serde_json::json;
use std::time::{Duration, Instant};
use url::Url;

const PAGE: &str = "https://ads.norisk.gg/launcher.html";

fn flag(page_url: &str, slots: serde_json::Value) -> String {
    json!({"pageUrl": page_url, "slots": slots}).to_string()
}

fn play_news(placement: &str, size: &str) -> serde_json::Value {
    json!({"play-news": {"enabled": true, "placement": placement, "size": size}})
}

fn from_flag(value: &str) -> Option<AdsConfig> {
    serde_json::from_str::<RawAdsConfig>(value)
        .ok()
        .and_then(AdsConfig::from_flag)
}

fn valid() -> AdsConfig {
    from_flag(&flag(PAGE, play_news("right-rail-1", "300x250"))).unwrap()
}

fn url(value: &str) -> Url {
    Url::parse(value).unwrap()
}

#[test]
fn a_valid_flag_points_each_slot_at_our_page_with_its_placement_and_size() {
    let config = valid();
    assert_eq!(
        config.ad_url("play-news").unwrap().as_str(),
        "https://ads.norisk.gg/launcher.html?placement=right-rail-1&size=300x250"
    );
    assert_eq!(
        config.sizes().get("play-news"),
        Some(&AdSize { width: 300, height: 250 })
    );
    assert!(!config.dev);
}

#[test]
fn the_consent_view_uses_a_configured_slot() {
    let config = valid();
    assert_eq!(config.ad_url(CONSENT_SLOT), config.ad_url("play-news"));
}

#[test]
fn unknown_slot_names_are_ignored() {
    let mut slots = play_news("right-rail-1", "300x250");
    slots["sidebar-top"] = json!({"enabled": true, "placement": "left-rail-1", "size": "300x600"});
    let config = from_flag(&flag(PAGE, slots)).unwrap();
    assert_eq!(config.ad_url("sidebar-top"), None);
    assert_eq!(config.sizes().len(), 1);

    let only_unknown =
        json!({"sidebar-top": {"enabled": true, "placement": "left-rail-1", "size": "300x600"}});
    assert_eq!(from_flag(&flag(PAGE, only_unknown)), None);
}

#[test]
fn a_disabled_slot_or_one_without_enabled_stays_hidden() {
    let disabled =
        json!({"play-news": {"enabled": false, "placement": "right-rail-1", "size": "300x250"}});
    let missing = json!({"play-news": {"placement": "right-rail-1", "size": "300x250"}});
    for slots in [disabled, missing] {
        assert_eq!(from_flag(&flag(PAGE, slots.clone())), None, "{slots}");
    }
}

#[test]
fn a_slot_with_a_bad_placement_or_size_is_rejected() {
    for (placement, size) in [
        ("Bad Name", "300x250"),
        ("a&b=c", "300x250"),
        ("", "300x250"),
        ("right-rail-1", "301x250"),
        ("right-rail-1", "300X250"),
        ("right-rail-1", "big"),
    ] {
        assert_eq!(
            from_flag(&flag(PAGE, play_news(placement, size))),
            None,
            "{placement} {size}"
        );
    }
}

#[test]
fn every_allowed_size_is_accepted() {
    for size in ["300x250", "300x600", "728x90", "320x50"] {
        let config = from_flag(&flag(PAGE, play_news("right-rail-1", size))).unwrap();
        let shown = config.sizes()["play-news"];
        assert_eq!(format!("{}x{}", shown.width, shown.height), size);
    }
}

#[test]
fn an_ad_page_outside_our_https_domain_turns_ads_off() {
    for page in [
        "http://ads.norisk.gg/launcher.html",
        "https://evil.example/launcher.html",
        "https://ads.norisk.gg.evil.example/launcher.html",
        "https://user:pw@ads.norisk.gg/launcher.html",
        "https://ads.norisk.gg:8443/launcher.html",
        "javascript:alert(1)",
        "not a url",
    ] {
        assert_eq!(
            from_flag(&flag(page, play_news("right-rail-1", "300x250"))),
            None,
            "{page}"
        );
    }
}

#[test]
fn a_broken_flag_value_turns_ads_off() {
    for value in ["", "true", "{}", r#"{"pageUrl":"https://ads.norisk.gg/launcher.html"}"#] {
        assert_eq!(from_flag(value), None, "{value}");
    }
}

#[test]
fn only_confirmed_free_users_on_windows_see_ads() {
    let config = valid();
    assert!(shows_ads(Some(&config), Some(false), "windows"));

    assert!(!shows_ads(None, Some(false), "windows"));
    assert!(!shows_ads(Some(&config), Some(true), "windows"));
    assert!(!shows_ads(Some(&config), None, "windows"));
    assert!(!shows_ads(Some(&config), Some(false), "macos"));
    assert!(!shows_ads(Some(&config), Some(false), "linux"));
}

#[test]
fn the_flag_can_show_ads_to_norisk_plus_players_too() {
    let config = from_flag(
        &json!({"pageUrl": PAGE, "plusSeesAds": true, "slots": play_news("right-rail-1", "300x250")})
            .to_string(),
    )
    .unwrap();

    assert!(shows_ads(Some(&config), Some(true), "windows"));
    assert!(shows_ads(Some(&config), Some(false), "windows"));
    assert!(!shows_ads(Some(&config), Some(true), "macos"));
}

#[test]
fn reviq_placement_names_are_accepted() {
    for placement in ["right-rail-1", "left-rail-1", "launcher-home"] {
        let config = from_flag(&flag(PAGE, play_news(placement, "300x250"))).unwrap();
        let ad_url = config.ad_url("play-news").unwrap();
        assert!(ad_url.as_str().contains(&format!("placement={placement}")));
    }
}

#[test]
fn the_dev_switch_asks_the_ad_page_for_test_ads() {
    let value = json!({
        "pageUrl": "https://ads.norisk.gg/launcher.html?old=1#top",
        "dev": true,
        "slots": play_news("right-rail-1", "300x250")
    });
    let config = from_flag(&value.to_string()).unwrap();
    assert_eq!(
        config.ad_url("play-news").unwrap().as_str(),
        "https://ads.norisk.gg/launcher.html?placement=right-rail-1&size=300x250&dev=1"
    );
}

#[test]
fn only_the_ad_page_on_our_domain_can_report_ad_events() {
    let page = url("https://ads.norisk.gg/launcher.html");
    assert!(ad_page_ipc_allowed(ADS_WEBVIEW_LABEL, Some(&page)));
}

#[test]
fn a_page_that_left_our_domain_cannot_report_ad_events() {
    let elsewhere = url("https://evil.example/");
    assert!(!ad_page_ipc_allowed(ADS_WEBVIEW_LABEL, Some(&elsewhere)));
    assert!(!ad_page_ipc_allowed(ADS_WEBVIEW_LABEL, Some(&url("http://ads.norisk.gg/launcher.html"))));
    assert!(!ad_page_ipc_allowed(ADS_WEBVIEW_LABEL, None));
}

#[test]
fn launcher_windows_cannot_report_ad_events() {
    let page = url("https://ads.norisk.gg/launcher.html");
    for label in ["main", "clip_editor", "updater"] {
        assert!(!ad_page_ipc_allowed(label, Some(&page)), "{label}");
        assert!(!ad_page_ipc_allowed(label, None), "{label}");
    }
}

#[test]
fn the_ad_page_cannot_leave_our_domain() {
    assert!(navigation_allowed(&url("https://ads.norisk.gg/launcher.html?placement=a")));
    assert!(navigation_allowed(&url("about:blank")));

    assert!(!navigation_allowed(&url("https://evil.example/")));
    assert!(!navigation_allowed(&url("http://ads.norisk.gg/launcher.html")));
    for blocked in ["file:///etc/passwd", "norisk://launch", "tauri://localhost/", "data:text/html,x"] {
        assert!(!navigation_allowed(&url(blocked)), "{blocked}");
    }
}

#[test]
fn a_real_click_opens_one_web_link() {
    let now = Instant::now();
    let mut gate = ClickGate::default();
    gate.record_click(now);

    let opened = gate.admit("https://shop.example/landing?x=1", now + Duration::from_millis(200), true);
    assert_eq!(opened.unwrap().as_str(), "https://shop.example/landing?x=1");
    assert!(gate.admit("https://shop.example/second", now + Duration::from_millis(300), true).is_none());
}

#[test]
fn a_link_without_a_click_is_never_opened() {
    let now = Instant::now();
    let mut gate = ClickGate::default();
    assert!(gate.admit("https://shop.example/", now, true).is_none());

    gate.record_click(now);
    assert!(gate.admit("https://shop.example/", now + CLICK_WINDOW + Duration::from_millis(1), true).is_none());
}

#[test]
fn only_web_links_are_opened() {
    let now = Instant::now();
    for link in [
        "file:///C:/Windows/System32/calc.exe",
        "javascript:alert(1)",
        "norisk://launch",
        "ms-settings:privacy",
        "mailto:a@b.c",
        "relative/path",
    ] {
        let mut gate = ClickGate::default();
        gate.record_click(now);
        assert!(gate.admit(link, now, true).is_none(), "{link}");
    }

    let mut gate = ClickGate::default();
    gate.record_click(now);
    let too_long = format!("https://shop.example/{}", "a".repeat(MAX_AD_URL_LEN));
    assert!(gate.admit(&too_long, now, true).is_none());
}

#[test]
fn rapid_clicks_open_at_most_one_link_every_two_seconds() {
    let start = Instant::now();
    let mut gate = ClickGate::default();

    gate.record_click(start);
    assert!(gate.admit("https://a.example/", start, true).is_some());

    let soon = start + Duration::from_millis(500);
    gate.record_click(soon);
    assert!(gate.admit("https://b.example/", soon, true).is_none());

    let later = start + OPEN_INTERVAL;
    gate.record_click(later);
    assert!(gate.admit("https://c.example/", later, true).is_some());
}

#[test]
fn the_ad_reloads_at_most_every_thirty_seconds() {
    let now = Instant::now();
    assert_eq!(reload_delay(None, now), Duration::ZERO);
    assert_eq!(reload_delay(Some(now), now), RELOAD_INTERVAL);
    assert_eq!(
        reload_delay(Some(now), now + Duration::from_secs(10)),
        Duration::from_secs(20)
    );
    assert_eq!(reload_delay(Some(now), now + Duration::from_secs(45)), Duration::ZERO);
}

#[test]
fn an_ad_cannot_open_links_while_the_launcher_is_not_the_active_window() {
    let now = Instant::now();
    let mut gate = ClickGate::default();
    gate.record_click(now);
    assert!(gate.admit("https://shop.example/", now, false).is_none());
}

#[test]
fn the_ad_page_can_only_report_known_privacy_modes() {
    assert_eq!(ConsentMode::parse("closed"), Some(ConsentMode::Closed));
    assert_eq!(ConsentMode::parse("prompt"), Some(ConsentMode::Prompt));
    assert_eq!(ConsentMode::parse("dialog"), Some(ConsentMode::Dialog));
    assert_eq!(ConsentMode::parse("fullscreen"), None);
}

#[test]
fn the_ad_page_cannot_open_the_full_window_dialog_on_its_own() {
    assert!(!accepts_page_mode(ConsentMode::Closed, false, ConsentMode::Dialog));
    assert!(accepts_page_mode(ConsentMode::Closed, true, ConsentMode::Dialog));
    assert!(accepts_page_mode(ConsentMode::Prompt, false, ConsentMode::Dialog));
    assert!(accepts_page_mode(ConsentMode::Closed, false, ConsentMode::Prompt));
    assert!(accepts_page_mode(ConsentMode::Dialog, false, ConsentMode::Closed));
}

#[test]
fn closing_the_privacy_prompt_or_dialog_reloads_the_ad_page() {
    assert!(reload_after_consent(ConsentMode::Prompt, ConsentMode::Closed));
    assert!(reload_after_consent(ConsentMode::Dialog, ConsentMode::Closed));
    assert!(!reload_after_consent(ConsentMode::Closed, ConsentMode::Closed));
    assert!(!reload_after_consent(ConsentMode::Prompt, ConsentMode::Dialog));
}

#[test]
fn only_known_prompt_answers_reach_the_ad_page() {
    assert_eq!(ConsentAction::parse("accept"), Some(ConsentAction::Accept));
    assert_eq!(ConsentAction::parse("reject"), Some(ConsentAction::Reject));
    assert_eq!(ConsentAction::parse("customize"), Some(ConsentAction::Customize));
    assert_eq!(ConsentAction::parse("vendors"), None);
    assert_eq!(ConsentAction::parse("accept\"); alert(1); //"), None);
}

#[test]
fn the_privacy_dialog_gets_the_whole_window_to_size_itself() {
    let rect = consent_rect(1280.0, 800.0);
    assert_eq!((rect.x, rect.y, rect.width, rect.height), (0.0, 0.0, 1280.0, 800.0));
}

fn screen(left: i32, top: i32, right: i32, bottom: i32) -> ScreenRect {
    ScreenRect { left, top, right, bottom }
}

#[test]
fn an_ad_without_windows_above_it_is_visible() {
    assert!(!is_occluded(screen(0, 0, 300, 250), &[]));
}

#[test]
fn a_window_over_the_whole_ad_hides_it() {
    assert!(is_occluded(screen(100, 100, 400, 350), &[screen(0, 0, 1920, 1080)]));
}

#[test]
fn a_window_over_a_corner_keeps_the_ad() {
    assert!(!is_occluded(screen(0, 0, 300, 250), &[screen(0, 0, 150, 125)]));
}

#[test]
fn two_windows_together_over_most_of_the_ad_hide_it() {
    let left_half = screen(0, 0, 150, 250);
    let right_part = screen(150, 0, 240, 250);
    assert!(is_occluded(screen(0, 0, 300, 250), &[left_half, right_part]));
}

#[test]
fn stacked_windows_over_the_same_spot_count_once() {
    let corner = screen(0, 0, 100, 250);
    assert!(!is_occluded(screen(0, 0, 300, 250), &[corner, corner, corner]));
}

#[test]
fn ads_count_as_personalized_only_with_both_profile_purposes() {
    assert!(personalized_ads(&[1, 2, 3, 4, 7]));
    assert!(!personalized_ads(&[1, 2, 3]));
    assert!(!personalized_ads(&[1, 2, 4]));
    assert!(!personalized_ads(&[]));
}

#[test]
fn an_oversized_purpose_list_from_the_page_is_ignored() {
    let flood: Vec<u32> = (0..10_000).collect();
    assert!(!personalized_ads(&flood));
}
