use super::*;

fn required(project_id: &str) -> UnifiedDependency {
    UnifiedDependency {
        project_id: Some(project_id.to_string()),
        version_id: None,
        file_name: None,
        dependency_type: UnifiedDependencyType::Required,
    }
}

fn target() -> DependencyTarget {
    DependencyTarget {
        loader: "fabric".to_string(),
        game_version: "1.21.1".to_string(),
    }
}

#[tokio::test]
async fn a_project_the_caller_already_resolved_is_not_looked_up_again() {
    let mut seen = HashSet::new();
    seen.insert(format!("{:?}:{}", ModPlatform::Modrinth, "fabric-api"));

    let resolved = resolve_required_dependencies_seen(
        &ModPlatform::Modrinth,
        &[required("fabric-api")],
        "2024-01-01T00:00:00Z",
        &target(),
        DEPENDENCY_DEPTH,
        &mut seen,
    )
    .await;

    assert!(
        resolved.is_empty(),
        "a shared seen set is what keeps a bulk update from asking the API once per mod"
    );
}

#[tokio::test]
async fn optional_dependencies_never_reach_the_network() {
    let mut seen = HashSet::new();
    let optional = UnifiedDependency {
        project_id: Some("sodium".to_string()),
        version_id: None,
        file_name: None,
        dependency_type: UnifiedDependencyType::Optional,
    };

    let resolved = resolve_required_dependencies_seen(
        &ModPlatform::Modrinth,
        &[optional],
        "2024-01-01T00:00:00Z",
        &target(),
        DEPENDENCY_DEPTH,
        &mut seen,
    )
    .await;

    assert!(resolved.is_empty());
    assert!(seen.is_empty(), "an optional dependency must not even be marked as seen");
}

#[tokio::test]
async fn a_dependency_without_a_project_id_is_skipped() {
    let mut seen = HashSet::new();
    let anonymous = UnifiedDependency {
        project_id: None,
        version_id: Some("abc".to_string()),
        file_name: None,
        dependency_type: UnifiedDependencyType::Required,
    };

    let resolved = resolve_required_dependencies_seen(
        &ModPlatform::Modrinth,
        &[anonymous],
        "2024-01-01T00:00:00Z",
        &target(),
        DEPENDENCY_DEPTH,
        &mut seen,
    )
    .await;

    assert!(resolved.is_empty());
}

#[tokio::test]
async fn curseforge_is_deduped_the_same_way() {
    let mut seen = HashSet::new();
    seen.insert(format!("{:?}:{}", ModPlatform::CurseForge, "306612"));

    let resolved = resolve_required_dependencies_seen(
        &ModPlatform::CurseForge,
        &[required("306612")],
        "2024-01-01T00:00:00Z",
        &target(),
        DEPENDENCY_DEPTH,
        &mut seen,
    )
    .await;

    assert!(resolved.is_empty());
}

#[test]
fn the_same_id_on_two_platforms_stays_two_entries() {
    let mut seen = HashSet::new();
    assert!(seen.insert(format!("{:?}:{}", ModPlatform::Modrinth, "12345")));
    assert!(
        seen.insert(format!("{:?}:{}", ModPlatform::CurseForge, "12345")),
        "an id means different projects on different platforms"
    );
    assert_eq!(seen.len(), 2);
}
