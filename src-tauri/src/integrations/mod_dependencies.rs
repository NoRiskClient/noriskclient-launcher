use crate::integrations::unified_mod::{
    get_mod_versions_unified, ModPlatform, UnifiedDependency, UnifiedDependencyType,
    UnifiedModVersionsParams, UnifiedVersion,
};
use log::{error, info, warn};
use std::collections::{HashSet, VecDeque};

pub const DEPENDENCY_DEPTH: u8 = 20;

pub struct DependencyTarget {
    pub loader: String,
    pub game_version: String,
}

pub struct ResolvedDependency {
    pub project_id: String,
    pub version: UnifiedVersion,
}

pub fn pick_version<'a>(
    versions: &'a [UnifiedVersion],
    pinned_version_id: Option<&String>,
    game_version: &str,
    parent_date: &str,
) -> Option<&'a UnifiedVersion> {
    pinned_version_id
        .and_then(|id| versions.iter().find(|version| &version.id == id))
        .or_else(|| {
            versions
                .iter()
                .filter(|version| {
                    version.game_versions.iter().any(|v| v == game_version)
                        && version.date_published.as_str() <= parent_date
                })
                .max_by(|a, b| a.date_published.cmp(&b.date_published))
        })
        .or_else(|| {
            versions
                .iter()
                .filter(|version| version.game_versions.iter().any(|v| v == game_version))
                .max_by(|a, b| a.date_published.cmp(&b.date_published))
        })
        .or_else(|| {
            versions
                .iter()
                .max_by(|a, b| a.date_published.cmp(&b.date_published))
        })
}

pub async fn resolve_required_dependencies(
    platform: &ModPlatform,
    dependencies: &[UnifiedDependency],
    parent_date: &str,
    target: &DependencyTarget,
    max_depth: u8,
) -> Vec<ResolvedDependency> {
    let mut resolved = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(Vec<UnifiedDependency>, String, u8)> = VecDeque::new();
    queue.push_back((dependencies.to_vec(), parent_date.to_string(), max_depth));

    while let Some((batch, batch_parent_date, depth)) = queue.pop_front() {
        if depth == 0 {
            warn!("Dependency chain too deep, stopping here");
            continue;
        }

        for dependency in batch {
            if dependency.dependency_type != UnifiedDependencyType::Required {
                continue;
            }

            let Some(project_id) = dependency.project_id.clone() else {
                continue;
            };

            if !seen.insert(format!("{:?}:{}", platform, project_id)) {
                continue;
            }

            let params = UnifiedModVersionsParams {
                source: platform.clone(),
                project_id: project_id.clone(),
                loaders: Some(vec![target.loader.clone()]),
                game_versions: Some(vec![target.game_version.clone()]),
                limit: None,
                offset: None,
            };

            let versions = match get_mod_versions_unified(params).await {
                Ok(response) => response.versions,
                Err(e) => {
                    error!("Failed to get versions for dependency '{}': {}", project_id, e);
                    continue;
                }
            };

            let Some(chosen) = pick_version(
                &versions,
                dependency.version_id.as_ref(),
                &target.game_version,
                &batch_parent_date,
            ) else {
                warn!("No compatible version found for dependency '{}'", project_id);
                continue;
            };

            info!(
                "[dep-resolve] {} pin={:?} parent_date={} candidates={} -> chosen={:?}",
                project_id,
                dependency.version_id,
                batch_parent_date,
                versions.len(),
                chosen.version_number
            );

            if !chosen.dependencies.is_empty() {
                queue.push_back((
                    chosen.dependencies.clone(),
                    chosen.date_published.clone(),
                    depth - 1,
                ));
            }

            resolved.push(ResolvedDependency {
                project_id,
                version: chosen.clone(),
            });
        }
    }

    resolved
}

pub async fn version_details(
    platform: &ModPlatform,
    project_id: &str,
    version_id: &str,
) -> Option<UnifiedVersion> {
    match platform {
        ModPlatform::Modrinth => crate::integrations::modrinth::get_version_details(
            version_id.to_string(),
        )
        .await
        .ok()
        .map(|version| version.into()),
        ModPlatform::CurseForge => {
            let project = project_id.parse::<u32>().ok()?;
            let file = version_id.parse::<u32>().ok()?;
            crate::integrations::curseforge::get_file_details(project, file)
                .await
                .ok()
                .map(|file| file.into())
        }
    }
}
