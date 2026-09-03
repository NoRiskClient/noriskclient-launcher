use super::buckets;
use super::copy::{self, CopyPlan};
use super::detect;
use super::model::*;
use super::resolve;
use crate::error::Result;
use crate::integrations::pack_preview::NoriskPackOffer;
use crate::integrations::provenance::{classify_executable_entries, ProvenanceReport};
use crate::state::profile_state::ProfileSettings;
use crate::state::State;
use crate::utils::import_safety::{sanitize_settings, ImportSecurityReport};
use chrono::{DateTime, Utc};
use std::path::Path;

pub struct PreviewOptions {
    pub selection: ImportSelection,
    pub resolve_mods: bool,
}

pub async fn read_instance(
    launcher: ExternalLauncher,
    root: &Path,
    instance_dir: &Path,
) -> Result<ExternalInstance> {
    let (adapter, resolved) = detect::open(launcher, root).await?;
    adapter.read_instance(&resolved, instance_dir).await
}

pub fn security_report_for(instance: &ExternalInstance) -> ImportSecurityReport {
    let mut report = ImportSecurityReport::default();

    let claimed = ProfileSettings {
        use_custom_java_path: instance.untrusted_java_path.is_some(),
        java_path: instance.untrusted_java_path.clone(),
        extra_game_args: instance.untrusted_game_args.clone(),
        custom_jvm_args: instance.untrusted_jvm_args.clone(),
        ..ProfileSettings::default()
    };

    sanitize_settings(claimed, &mut report);
    report
}

pub async fn already_imported_at(instance_dir: &Path) -> Option<DateTime<Utc>> {
    let state = State::get().await.ok()?;
    let profiles = state.profile_manager.list_profiles().await.ok()?;
    let needle = instance_dir.display().to_string().to_ascii_lowercase();

    profiles.into_iter().find_map(|profile| {
        let marker = profile.extra.get(IMPORTED_FROM_KEY)?;
        let imported: ImportedFrom = serde_json::from_value(marker.clone()).ok()?;
        (imported.instance_dir.to_ascii_lowercase() == needle).then_some(imported.imported_at)
    })
}

fn collect_warnings(instance: &ExternalInstance, plan: &CopyPlan) -> Vec<String> {
    let mut warnings = instance.warnings.clone();

    warnings.extend(
        plan.skipped_symlinks
            .iter()
            .map(|symlink| format!("skipped_symlink:{}", symlink)),
    );

    if plan.truncated {
        warnings.push("copy_plan_truncated".to_string());
    }

    warnings
}

pub async fn preview_instance(
    launcher: ExternalLauncher,
    root: &Path,
    instance_dir: &Path,
    options: PreviewOptions,
) -> Result<ExternalInstancePreview> {
    let instance = read_instance(launcher, root, instance_dir).await?;
    let plan = copy::build_plan(
        &instance.game_dir,
        &options.selection,
        &ImportSelection::default(),
    )
    .await;

    let resolution = match (options.resolve_mods, instance.reference.game_version.as_deref()) {
        (true, Some(game_version)) => {
            Some(resolve::resolve_instance_mods(&instance, game_version).await)
        }
        _ => None,
    };

    let (jars, jars_truncated) = match resolution.as_deref() {
        Some(resolved) => (resolved.jars.clone(), resolved.truncated),
        None => resolve::discover_jars(&instance.game_dir).await,
    };

    let mut provenance = match resolution.as_deref() {
        Some(resolved) => resolved.provenance.clone(),
        None => ProvenanceReport {
            incomplete: true,
            ..Default::default()
        },
    };
    if jars_truncated {
        provenance.incomplete = true;
    }

    let mods_bytes = if options.selection.mods {
        plan.bucket_bytes(buckets::MODS)
    } else {
        0
    };

    Ok(ExternalInstancePreview {
        launcher,
        launcher_display_name: launcher.display_name().to_string(),
        root: root.display().to_string(),
        instance_dir: instance_dir.display().to_string(),
        suggested_name: instance.reference.name.clone(),
        suggested_group: Some(launcher.suggested_group().to_string()),
        game_version: instance.reference.game_version.clone(),
        loader: instance.reference.loader.clone(),
        loader_version: instance.reference.loader_version.clone(),
        mod_count: jars.len(),
        disabled_mod_count: jars.iter().filter(|jar| !jar.enabled).count(),
        total_bytes: plan.total_instance_bytes(),
        selected_bytes: plan.total_bytes + mods_bytes,
        icon: match instance.icon.as_ref() {
            Some(icon) => icon.as_image_source().await,
            None => None,
        },
        security: security_report_for(&instance),
        executable_content: classify_executable_entries(plan.executable_paths.clone(), &[""]),
        managed_pack: instance.managed_pack.as_ref().map(ManagedPackRef::label),
        norisk_pack: NoriskPackOffer::default(),
        warnings: collect_warnings(&instance, &plan),
        already_imported_at: already_imported_at(instance_dir).await,
        buckets: plan.per_bucket,
        provenance,
    })
}
