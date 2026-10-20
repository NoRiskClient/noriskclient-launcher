use noriskclient_launcher_v3_lib::state::profile_state::ModLoader;
use noriskclient_launcher_v3_lib::support::handlers::update_loader::latest_stable;

#[test]
fn latest_picks_newest_stable() {
    let fabric = vec![
        "0.17.3".to_string(),
        "0.17.2 (stable)".to_string(),
        "0.17.1 (stable)".to_string(),
    ];
    assert_eq!(
        latest_stable(&ModLoader::Fabric, &fabric),
        "0.17.2 (stable)"
    );
    let neo = vec!["21.1.80-beta".to_string(), "21.1.79".to_string()];
    assert_eq!(latest_stable(&ModLoader::NeoForge, &neo), "21.1.79");
    let only_beta = vec!["21.1.80-beta".to_string()];
    assert_eq!(
        latest_stable(&ModLoader::NeoForge, &only_beta),
        "21.1.80-beta"
    );
}
