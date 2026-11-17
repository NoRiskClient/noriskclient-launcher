use crate::integrations::curseforge::CURSEFORGE_FINGERPRINT_BATCH;
use crate::integrations::mod_lookup::MODRINTH_HASH_BATCH;
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_LISTED_EXECUTABLE_FILES: usize = 40;

const SCRIPT_EXTENSIONS: &[&str] = &["js", "zs", "groovy", "lua", "py", "rhai", "kts"];

const NATIVE_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "scr", "msi", "ps1", "vbs", "wsf", "sh", "bash", "dll", "so",
    "dylib", "app", "jar",
];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UnknownReason {
    NoHash,
    NotOnPlatform,
    BundledFile,
    LocalSource,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnknownContent {
    pub name: String,
    pub reason: UnknownReason,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceReport {
    pub verified_count: usize,
    pub unknown: Vec<UnknownContent>,
    pub incomplete: bool,
}

impl ProvenanceReport {
    pub fn push_unknown(&mut self, name: impl Into<String>, reason: UnknownReason) {
        self.unknown.push(UnknownContent {
            name: name.into(),
            reason,
        });
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableContentReport {
    pub scripts: Vec<String>,
    pub natives: Vec<String>,
    pub script_count: usize,
    pub native_count: usize,
    pub truncated: bool,
}

pub fn classify_executable_entries<I>(names: I, override_prefixes: &[&str]) -> ExecutableContentReport
where
    I: IntoIterator<Item = String>,
{
    let lowered_prefixes: Vec<String> = override_prefixes
        .iter()
        .map(|prefix| prefix.to_ascii_lowercase())
        .collect();

    let mut report = ExecutableContentReport::default();

    for name in names {
        if name.ends_with('/') {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        let Some(prefix) = lowered_prefixes
            .iter()
            .find(|prefix| lower.starts_with(prefix.as_str()))
        else {
            continue;
        };

        let Some(extension) = lower.rsplit_once('.').map(|(_, ext)| ext) else {
            continue;
        };
        let in_mods_dir = lower.starts_with(&format!("{}mods/", prefix));

        if NATIVE_EXTENSIONS.contains(&extension) {
            if extension == "jar" && in_mods_dir {
                continue;
            }
            report.natives.push(name);
        } else if SCRIPT_EXTENSIONS.contains(&extension) {
            report.scripts.push(name);
        }
    }

    report.scripts.sort();
    report.natives.sort();
    report.script_count = report.scripts.len();
    report.native_count = report.natives.len();

    if report.scripts.len() > MAX_LISTED_EXECUTABLE_FILES {
        report.scripts.truncate(MAX_LISTED_EXECUTABLE_FILES);
        report.truncated = true;
    }
    if report.natives.len() > MAX_LISTED_EXECUTABLE_FILES {
        report.natives.truncate(MAX_LISTED_EXECUTABLE_FILES);
        report.truncated = true;
    }

    report
}

pub async fn classify_by_modrinth_hash(
    items: Vec<(String, String)>,
    unknown_reason: UnknownReason,
    report: &mut ProvenanceReport,
) {
    if items.is_empty() {
        return;
    }

    for chunk in items.chunks(MODRINTH_HASH_BATCH) {
        let hashes: Vec<String> = chunk.iter().map(|(_, hash)| hash.clone()).collect();
        match crate::integrations::modrinth::get_versions_by_hashes(hashes, "sha1").await {
            Ok(found) => {
                let known: HashSet<String> = found.keys().map(|k| k.to_lowercase()).collect();
                for (name, hash) in chunk {
                    if known.contains(hash) {
                        report.verified_count += 1;
                    } else {
                        report.push_unknown(name.clone(), unknown_reason);
                    }
                }
            }
            Err(e) => {
                warn!("Modrinth provenance lookup failed: {}", e);
                report.incomplete = true;
            }
        }
    }
}

pub async fn classify_by_curseforge_fingerprint(
    items: Vec<(String, u64)>,
    report: &mut ProvenanceReport,
) {
    if items.is_empty() {
        return;
    }

    for chunk in items.chunks(CURSEFORGE_FINGERPRINT_BATCH) {
        let prints: Vec<u64> = chunk.iter().map(|(_, print)| *print).collect();
        match crate::integrations::curseforge::fingerprints_known(prints).await {
            Ok(known) => {
                for (name, print) in chunk {
                    if known.contains(print) {
                        report.verified_count += 1;
                    } else {
                        report.push_unknown(name.clone(), UnknownReason::NotOnPlatform);
                    }
                }
            }
            Err(e) => {
                warn!("CurseForge provenance lookup failed: {}", e);
                report.incomplete = true;
            }
        }
    }
}
