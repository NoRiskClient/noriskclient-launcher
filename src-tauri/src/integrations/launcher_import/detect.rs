use super::adapter::{exists, LauncherAdapter};
use super::model::{DetectedLauncher, ExternalLauncher, LauncherRoot};
use crate::error::{AppError, Result};
use log::debug;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn adapters() -> Vec<Box<dyn LauncherAdapter>> {
    vec![
        Box::new(super::adapters::modrinth_app::ModrinthAppAdapter),
        Box::new(super::adapters::curseforge_app::CurseForgeAppAdapter),
        Box::new(super::adapters::mmc::MmcAdapter::prism()),
        Box::new(super::adapters::mmc::MmcAdapter::multimc()),
        Box::new(super::adapters::atlauncher::AtLauncherAdapter),
    ]
}

pub fn adapter_for(launcher: ExternalLauncher) -> Result<Box<dyn LauncherAdapter>> {
    adapters()
        .into_iter()
        .find(|adapter| adapter.kind() == launcher)
        .ok_or_else(|| {
            AppError::Other(format!("No importer for launcher '{}'", launcher.as_str()))
        })
}

pub async fn open(
    launcher: ExternalLauncher,
    root: &Path,
) -> Result<(Box<dyn LauncherAdapter>, LauncherRoot)> {
    let adapter = adapter_for(launcher)?;
    let resolved = adapter.probe(root).await.ok_or_else(|| {
        AppError::Other(format!(
            "'{}' does not look like a {} folder",
            root.display(),
            launcher.display_name()
        ))
    })?;

    Ok((adapter, resolved))
}

pub async fn resolve_root(launcher: ExternalLauncher, root: &Path) -> Result<LauncherRoot> {
    open(launcher, root).await.map(|(_, resolved)| resolved)
}

fn dedup_key(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string()
        .to_ascii_lowercase()
}

async fn describe(
    adapter: &dyn LauncherAdapter,
    root: LauncherRoot,
    auto_detected: bool,
) -> DetectedLauncher {
    DetectedLauncher {
        launcher: root.launcher,
        display_name: root.launcher.display_name().to_string(),
        instance_count: adapter.count_instances(&root).await,
        root: root.root.display().to_string(),
        instances_dir: root.instances_dir.display().to_string(),
        auto_detected,
    }
}

pub async fn scan_all() -> Vec<DetectedLauncher> {
    let adapters = adapters();

    let probes = adapters.iter().map(|adapter| async move {
        let mut found = Vec::new();
        for candidate in adapter.candidate_roots() {
            if !exists(&candidate).await {
                continue;
            }
            if let Some(root) = adapter.probe(&candidate).await {
                found.push(describe(adapter.as_ref(), root, true).await);
            }
        }
        found
    });

    let mut seen: HashSet<String> = HashSet::new();
    let mut detected = Vec::new();

    for entry in futures::future::join_all(probes).await.into_iter().flatten() {
        if entry.instance_count == 0 {
            debug!("Skipping empty launcher root '{}'", entry.root);
            continue;
        }
        if seen.insert(dedup_key(Path::new(&entry.root))) {
            detected.push(entry);
        }
    }

    detected
}

pub async fn identify_launcher_at(path: &Path) -> Option<DetectedLauncher> {
    let candidates: Vec<PathBuf> = [Some(path.to_path_buf()), path.parent().map(Path::to_path_buf)]
        .into_iter()
        .flatten()
        .collect();

    for adapter in adapters() {
        for candidate in &candidates {
            let Some(root) = adapter.probe(candidate).await else {
                continue;
            };
            let described = describe(adapter.as_ref(), root, false).await;
            if described.instance_count > 0 {
                return Some(described);
            }
        }
    }

    None
}
