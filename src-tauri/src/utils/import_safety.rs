
use crate::error::{AppError, Result};
use crate::state::profile_state::{
    ImageSource, Mod, ModSource, Profile, ProfileBanner, ProfileSettings,
};
use log::warn;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const ALLOWED_CONTENT_EXTENSIONS: &[&str] = &["jar", "zip"];

pub const MODRINTH_HOSTS: &[&str] = &["cdn.modrinth.com"];
const CURSEFORGE_HOSTS: &[&str] = &[
    "edge.forgecdn.net",
    "mediafilez.forgecdn.net",
    "media.forgecdn.net",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RejectedMod {
    pub display_name: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportSecurityReport {
    pub stripped_java_path: Option<String>,
    pub stripped_jvm_args: Option<String>,
    pub stripped_game_args: Vec<String>,
    pub stripped_quick_play_path: Option<String>,
    pub stripped_loader_version: Option<String>,
    pub rejected_mods: Vec<RejectedMod>,
    pub third_party_download_hosts: Vec<String>,
    pub unverified_mod_count: usize,
    pub stripped_profile_flags: Vec<String>,
}

impl ImportSecurityReport {
    pub fn is_clean(&self) -> bool {
        self.stripped_java_path.is_none()
            && self.stripped_jvm_args.is_none()
            && self.stripped_game_args.is_empty()
            && self.stripped_quick_play_path.is_none()
            && self.stripped_loader_version.is_none()
            && self.rejected_mods.is_empty()
            && self.third_party_download_hosts.is_empty()
            && self.unverified_mod_count == 0
            && self.stripped_profile_flags.is_empty()
    }

    pub fn has_critical_findings(&self) -> bool {
        self.stripped_java_path.is_some()
            || self.stripped_jvm_args.is_some()
            || !self.stripped_game_args.is_empty()
            || !self.rejected_mods.is_empty()
    }
}

pub fn parse_untrusted_profile(json: &str) -> Result<(Profile, ImportSecurityReport)> {
    let mut profile: Profile = serde_json::from_str(json).map_err(AppError::Json)?;
    let report = sanitize_imported_profile(&mut profile);
    Ok((profile, report))
}

pub fn safe_relative_path(path: &str) -> Result<PathBuf> {
    let reject = |why: &str| -> AppError {
        AppError::Other(format!("Unsafe relative path '{}': {}", path, why))
    };

    let mut normalized = PathBuf::new();
    for segment in path.split(['/', '\\']) {
        if segment.is_empty() {
            continue;
        }
        if segment.contains('\0') {
            return Err(reject("contains a NUL byte"));
        }

        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => {}
            _ => return Err(reject("contains a segment that is not a plain name")),
        }

        normalized.push(segment);
    }

    if normalized.as_os_str().is_empty() {
        return Err(reject("resolves to no path segments"));
    }

    Ok(normalized)
}

pub fn safe_file_component(name: &str) -> Result<String> {
    let reject = |why: &str| -> AppError {
        AppError::Other(format!("Unsafe file name '{}': {}", name, why))
    };

    if name.is_empty() {
        return Err(reject("empty"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(reject("contains a path separator"));
    }
    if name.contains('\0') {
        return Err(reject("contains a NUL byte"));
    }

    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err(reject("is not a single plain path component")),
    }

    let cleaned = sanitize_filename::sanitize_with_options(
        name,
        sanitize_filename::Options {
            windows: true,
            truncate: true,
            replacement: "",
        },
    );
    if cleaned != name {
        return Err(reject("contains characters that are not valid in a file name"));
    }

    Ok(cleaned)
}

pub fn sanitize_imported_profile(profile: &mut Profile) -> ImportSecurityReport {
    let mut report = ImportSecurityReport::default();

    let claimed = std::mem::take(&mut profile.settings);

    if claimed.use_custom_java_path || claimed.java_path.is_some() {
        report.stripped_java_path = claimed
            .java_path
            .clone()
            .or_else(|| Some("<enabled without a path>".to_string()));
    }
    if let Some(args) = claimed
        .custom_jvm_args
        .as_ref()
        .filter(|a| !a.trim().is_empty())
    {
        report.stripped_jvm_args = Some(args.clone());
    }
    if !claimed.extra_game_args.is_empty() {
        report.stripped_game_args = claimed.extra_game_args.clone();
    }
    if let Some(path) = claimed
        .quick_play_path
        .as_ref()
        .filter(|p| !p.trim().is_empty())
    {
        report.stripped_quick_play_path = Some(path.clone());
    }

    let mut settings = ProfileSettings::default();
    settings.memory = claimed.memory;
    settings.resolution = claimed.resolution;
    settings.fullscreen = claimed.fullscreen;
    settings.use_overwrite_loader_version = claimed.use_overwrite_loader_version;

    match claimed.overwrite_loader_version.as_deref() {
        Some(v) if !is_version_like(v) => {
            report.stripped_loader_version = Some(v.to_string());
            settings.use_overwrite_loader_version = false;
        }
        other => settings.overwrite_loader_version = other.map(str::to_string),
    }
    settings.overwrite_loader_versions = claimed
        .overwrite_loader_versions
        .into_iter()
        .filter(|(_, v)| is_version_like(v))
        .collect();

    profile.settings = settings;

    let mut kept: Vec<Mod> = Vec::with_capacity(profile.mods.len());
    for mod_info in std::mem::take(&mut profile.mods) {
        let label = mod_label(&mod_info);
        match inspect_mod(&mod_info, &mut report) {
            Ok(()) => kept.push(mod_info),
            Err(reason) => {
                warn!(
                    "Dropping mod '{}' from imported pack: {}",
                    label, reason
                );
                report.rejected_mods.push(RejectedMod {
                    display_name: label,
                    reason,
                });
            }
        }
    }
    profile.mods = kept;

    strip_profile_flags(profile, &mut report);

    report.third_party_download_hosts.sort();
    report.third_party_download_hosts.dedup();

    report
}

fn strip_profile_flags(profile: &mut Profile, report: &mut ImportSecurityReport) {
    if profile.is_standard_version {
        profile.is_standard_version = false;
        report
            .stripped_profile_flags
            .push("is_standard_version".to_string());
    }
    if profile.use_shared_minecraft_folder {
        profile.use_shared_minecraft_folder = false;
        report
            .stripped_profile_flags
            .push("use_shared_minecraft_folder".to_string());
    }
    if profile.preferred_account_id.take().is_some() {
        report
            .stripped_profile_flags
            .push("preferred_account_id".to_string());
    }
    if !std::mem::take(&mut profile.sync_pack_ids).is_empty() {
        report
            .stripped_profile_flags
            .push("sync_pack_ids".to_string());
    }
    profile.playtime_seconds = 0;

    if strip_unsafe_banner(&mut profile.banner) {
        report.stripped_profile_flags.push("banner".to_string());
    }
    if strip_unsafe_banner(&mut profile.background) {
        report.stripped_profile_flags.push("background".to_string());
    }
}

fn strip_unsafe_banner(banner: &mut Option<ProfileBanner>) -> bool {
    let keep = match banner.as_ref().map(|b| &b.source) {
        None => return false,
        Some(ImageSource::Base64 { .. }) => true,
        Some(ImageSource::Url { url }) => url.starts_with("https://"),
        Some(ImageSource::RelativeProfile { path }) => is_safe_relative_path(path),
        Some(ImageSource::AbsolutePath { .. }) | Some(ImageSource::RelativePath { .. }) => false,
    };

    if !keep {
        *banner = None;
    }
    !keep
}

fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

pub fn mod_label(mod_info: &Mod) -> String {
    if let Some(name) = &mod_info.display_name {
        if !name.trim().is_empty() {
            return name.clone();
        }
    }
    match &mod_info.source {
        ModSource::Modrinth { file_name, .. }
        | ModSource::CurseForge { file_name, .. }
        | ModSource::Local { file_name } => file_name.clone(),
        ModSource::Url { file_name, url } => file_name.clone().unwrap_or_else(|| url.clone()),
        ModSource::Maven { coordinates, .. } => coordinates.clone(),
        ModSource::Embedded { name } => name.clone(),
    }
}

fn raw_file_name(source: &ModSource) -> Option<&str> {
    match source {
        ModSource::Modrinth { file_name, .. }
        | ModSource::CurseForge { file_name, .. }
        | ModSource::Local { file_name } => Some(file_name.as_str()),
        ModSource::Url { file_name, .. } => file_name.as_deref(),
        ModSource::Maven { .. } | ModSource::Embedded { .. } => None,
    }
}

fn inspect_mod(mod_info: &Mod, report: &mut ImportSecurityReport) -> std::result::Result<(), String> {
    if let Some(name) = raw_file_name(&mod_info.source) {
        check_content_file_name(name)?;
    }
    if let Some(override_name) = mod_info.file_name_override.as_deref() {
        check_content_file_name(override_name)?;
    }

    match &mod_info.source {
        ModSource::Modrinth {
            download_url,
            file_hash_sha1,
            ..
        } => {
            require_host(download_url, MODRINTH_HOSTS, "Modrinth")?;
            if file_hash_sha1.is_none() {
                report.unverified_mod_count += 1;
            }
        }
        ModSource::CurseForge {
            download_url,
            file_hash_sha1,
            ..
        } => {
            require_host(download_url, CURSEFORGE_HOSTS, "CurseForge")?;
            if file_hash_sha1.is_none() {
                report.unverified_mod_count += 1;
            }
        }
        ModSource::Url { url, .. } => {
            let host = require_https(url)?;
            report.unverified_mod_count += 1;
            report.third_party_download_hosts.push(host);
        }
        ModSource::Maven {
            coordinates,
            repository_url,
        } => {
            if !coordinates
                .split(':')
                .all(|seg| !seg.is_empty() && seg.chars().all(is_coordinate_char))
            {
                return Err(format!("Maven coordinates '{}' are malformed", coordinates));
            }
            if let Some(repo) = repository_url {
                let host = require_https(repo)?;
                report.third_party_download_hosts.push(host);
            }
        }
        ModSource::Local { .. } | ModSource::Embedded { .. } => {}
    }

    Ok(())
}

pub fn check_content_file_name(name: &str) -> std::result::Result<(), String> {
    let cleaned = safe_file_component(name).map_err(|e| e.to_string())?;
    let extension = std::path::Path::new(&cleaned)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !ALLOWED_CONTENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "'{}' is not a .jar or .zip file",
            cleaned
        ));
    }
    Ok(())
}

fn require_https(url: &str) -> std::result::Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|_| format!("'{}' is not a valid URL", url))?;
    if parsed.scheme() != "https" {
        return Err(format!("'{}' does not use https", url));
    }
    parsed
        .host_str()
        .map(|h| h.to_ascii_lowercase())
        .ok_or_else(|| format!("'{}' has no host", url))
}

pub fn require_host(
    url: &str,
    allowed: &[&str],
    platform: &str,
) -> std::result::Result<(), String> {
    let host = require_https(url)?;
    if allowed.iter().any(|a| host == *a) {
        Ok(())
    } else {
        Err(format!(
            "{} mod claims to download from '{}', which is not a {} CDN",
            platform, host, platform
        ))
    }
}

fn is_coordinate_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+')
}

pub fn is_version_like(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
}
