use noriskclient_launcher_v3_lib::commands::share::convert::fitted_kbps;

const LIMIT: Option<u64> = Some(300 * 1024 * 1024);

#[test]
fn the_clip_setting_is_kept_when_it_fits_and_lowered_when_it_does_not() {
    assert_eq!(fitted_kbps(12_000, Some(60.0), LIMIT), 12_000);
    let lowered = fitted_kbps(100_000, Some(120.0), LIMIT);
    assert!((15_000..18_000).contains(&lowered), "{lowered}");
    assert_eq!(fitted_kbps(100_000, Some(100_000.0), LIMIT), 1_000);
}

#[test]
fn without_a_length_or_a_limit_the_setting_stays() {
    assert_eq!(fitted_kbps(50_000, None, LIMIT), 50_000);
    assert_eq!(fitted_kbps(50_000, Some(60.0), None), 50_000);
}
