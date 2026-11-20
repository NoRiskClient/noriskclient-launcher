use noriskclient_launcher_v3_lib::minecraft::modloader::forge_installer::declared_patched_client_jar;
use std::path::PathBuf;

#[test]
fn a_classifier_is_part_of_the_file_name() {
    assert_eq!(
        declared_patched_client_jar("[net.minecraftforge:forge:1.20.1-47.4.5:client]"),
        Some(PathBuf::from(
            "net/minecraftforge/forge/1.20.1-47.4.5/forge-1.20.1-47.4.5-client.jar"
        ))
    );
    assert_eq!(
        declared_patched_client_jar("[net.neoforged:neoforge:21.1.200:client]"),
        Some(PathBuf::from("net/neoforged/neoforge/21.1.200/neoforge-21.1.200-client.jar"))
    );
}

#[test]
fn neoforge_from_21_10_declares_a_coordinate_without_classifier() {
    assert_eq!(
        declared_patched_client_jar(" [net.neoforged:minecraft-client-patched:21.10.64] "),
        Some(PathBuf::from(
            "net/neoforged/minecraft-client-patched/21.10.64/minecraft-client-patched-21.10.64.jar"
        ))
    );
}

#[test]
fn a_value_that_is_no_coordinate_names_no_jar() {
    assert_eq!(declared_patched_client_jar("/data/client.lzma"), None);
    assert_eq!(declared_patched_client_jar("[net.neoforged:neoforge]"), None);
}
