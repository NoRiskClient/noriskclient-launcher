use super::super::adapter::{first_existing, is_dir, LauncherAdapter};
use super::super::loader_map;
use super::super::model::*;
use crate::error::{AppError, Result};
use crate::utils::import_safety::check_content_file_name;
use async_trait::async_trait;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const MARKERS: &[&str] = &["instance.json"];

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AtInstance {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    launcher: AtLauncherBlock,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AtLauncherBlock {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    pack: Option<String>,
    #[serde(default)]
    loader_version: Option<AtLoaderVersion>,
    #[serde(default)]
    mods: Vec<AtMod>,
    #[serde(default)]
    curse_forge_project: Option<AtCurseForgeRef>,
    #[serde(default)]
    curse_forge_file: Option<AtCurseForgeRef>,
    #[serde(default)]
    modrinth_project: Option<AtModrinthRef>,
    #[serde(default)]
    modrinth_version: Option<AtModrinthRef>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AtLoaderVersion {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Deserialize, Default)]
struct AtCurseForgeRef {
    #[serde(default)]
    id: Option<u32>,
}

#[derive(Deserialize, Default)]
struct AtModrinthRef {
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AtMod {
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    disabled: bool,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    curse_forge_project_id: Option<u32>,
    #[serde(default)]
    curse_forge_file_id: Option<u32>,
    #[serde(default)]
    modrinth_project: Option<AtModrinthRef>,
    #[serde(default)]
    modrinth_version: Option<AtModrinthRef>,
}

pub struct AtLauncherAdapter;

fn icon_stem(pack: &str) -> String {
    pack.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

impl AtInstance {
    async fn read(dir: &Path) -> Result<Self> {
        let raw = tokio::fs::read(dir.join("instance.json"))
            .await
            .map_err(AppError::Io)?;
        serde_json::from_slice(&raw).map_err(AppError::Json)
    }

    async fn icon(&self, root: &Path, dir: &Path) -> Option<IconRef> {
        let mut candidates = vec![dir.join("instance.png")];

        if let Some(pack) = self.launcher.pack.as_deref() {
            let stem = icon_stem(pack);
            if !stem.is_empty() {
                candidates.push(
                    root.join("configs")
                        .join("images")
                        .join(format!("{}.png", stem)),
                );
            }
        }

        first_existing(candidates).await.map(IconRef::File)
    }

    fn declared_mods(&self) -> Vec<DeclaredMod> {
        let mut mods = Vec::new();

        for entry in &self.launcher.mods {
            let Some(file_name) = entry.file.as_deref() else {
                continue;
            };
            if check_content_file_name(file_name).is_err() {
                log::warn!(
                    "Ignoring ATLauncher mod with unsafe file name '{}'",
                    file_name
                );
                continue;
            }

            let curseforge = entry
                .curse_forge_project_id
                .zip(entry.curse_forge_file_id);
            let modrinth = entry
                .modrinth_project
                .as_ref()
                .and_then(|reference| reference.id.clone())
                .zip(
                    entry
                        .modrinth_version
                        .as_ref()
                        .and_then(|reference| reference.id.clone()),
                );

            if curseforge.is_none() && modrinth.is_none() {
                continue;
            }

            mods.push(DeclaredMod {
                file_name: file_name.to_string(),
                enabled: !entry.disabled,
                curseforge,
                modrinth,
                display_name: entry.name.clone(),
                ..Default::default()
            });
        }

        mods
    }

    fn managed_pack(&self) -> Option<ManagedPackRef> {
        let launcher = &self.launcher;

        if let Some(project_id) = launcher
            .modrinth_project
            .as_ref()
            .and_then(|reference| reference.id.clone())
        {
            return Some(ManagedPackRef::Modrinth {
                project_id,
                version_id: launcher
                    .modrinth_version
                    .as_ref()
                    .and_then(|reference| reference.id.clone()),
            });
        }

        launcher
            .curse_forge_project
            .as_ref()
            .and_then(|reference| reference.id)
            .map(|project_id| ManagedPackRef::CurseForge {
                project_id,
                file_id: launcher
                    .curse_forge_file
                    .as_ref()
                    .and_then(|reference| reference.id),
            })
    }
}

#[async_trait]
impl LauncherAdapter for AtLauncherAdapter {
    fn kind(&self) -> ExternalLauncher {
        ExternalLauncher::AtLauncher
    }

    fn candidate_roots(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(data) = dirs::data_dir() {
            roots.push(data.join("ATLauncher"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".local").join("share").join("ATLauncher"));
            roots.push(home.join("ATLauncher"));
        }
        roots
    }

    async fn probe(&self, root: &Path) -> Option<LauncherRoot> {
        let instances_dir = root.join("instances");

        is_dir(&instances_dir).await.then(|| LauncherRoot {
            launcher: ExternalLauncher::AtLauncher,
            root: root.to_path_buf(),
            instances_dir,
        })
    }

    fn instance_markers(&self) -> &'static [&'static str] {
        MARKERS
    }

    async fn read_instance(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstance> {
        let manifest = AtInstance::read(dir).await?;

        let name = manifest
            .launcher
            .name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| folder_name(dir));

        let mut reference = ExternalInstanceRef::new(root, dir, name);
        reference.game_version = manifest.id.clone().filter(|value| !value.trim().is_empty());
        reference.mod_count = Some(manifest.launcher.mods.len());

        let mut warnings = Vec::new();

        if let Some(entry) = manifest.launcher.loader_version.as_ref() {
            let raw = entry.kind.as_deref().unwrap_or("");
            match loader_map::loader_from_name(raw) {
                Some(loader) => reference.set_loader(loader, entry.version.clone()),
                None => {
                    reference.mark_unsupported(UnsupportedReason::UnknownLoader);
                    warnings.push(format!("unknown_loader:{}", raw));
                }
            }
        }

        if reference.game_version.is_none() {
            reference.mark_unsupported(UnsupportedReason::NoGameVersion);
        }

        Ok(ExternalInstance {
            icon: manifest.icon(&root.root, dir).await,
            declared_mods: manifest.declared_mods(),
            managed_pack: manifest.managed_pack(),
            warnings,
            ..ExternalInstance::new(reference, dir.to_path_buf())
        })
    }
}
