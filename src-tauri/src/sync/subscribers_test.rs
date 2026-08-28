use super::*;

fn ctx(version: &str, loader: ModLoader) -> (String, ModLoader) {
    (version.to_string(), loader)
}

#[test]
fn newer_minecraft_versions_sort_before_older_ones() {
    let mut contexts = vec![
        ctx("1.21.11", ModLoader::Fabric),
        ctx("26.2", ModLoader::Fabric),
        ctx("1.8.9", ModLoader::Fabric),
    ];
    sort_contexts(&mut contexts);
    let order: Vec<&str> = contexts.iter().map(|(v, _)| v.as_str()).collect();
    assert_eq!(order, vec!["26.2", "1.21.11", "1.8.9"]);
}

#[test]
fn point_releases_sort_numerically_not_lexically() {
    let mut contexts = vec![
        ctx("1.21.2", ModLoader::Fabric),
        ctx("1.21.11", ModLoader::Fabric),
    ];
    sort_contexts(&mut contexts);
    let order: Vec<&str> = contexts.iter().map(|(v, _)| v.as_str()).collect();
    assert_eq!(order, vec!["1.21.11", "1.21.2"]);
}

#[test]
fn loaders_of_the_same_version_stay_alphabetical() {
    let mut contexts = vec![
        ctx("1.21.1", ModLoader::NeoForge),
        ctx("1.21.1", ModLoader::Fabric),
    ];
    sort_contexts(&mut contexts);
    let order: Vec<&str> = contexts.iter().map(|(_, l)| l.as_str()).collect();
    assert_eq!(order, vec!["fabric", "neoforge"]);
}
