use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::minecraft::dto::piston_meta::Library;
use crate::minecraft::launch::version::compare_versions;
use crate::minecraft::rules::RuleProcessor;
use log::{debug, info, trace};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

struct LibraryEntry {
    path: PathBuf,
    version: String,
    priority: u32,
}

/// Builds the JVM classpath.
///
/// A library's identity is its Maven coordinate — group, artifact and classifier, but never
/// the version, which only decides which of two competing copies wins. Identity must not be
/// derived from the file name: `forge-…-client.jar` and `forge-…-universal.jar` then look like
/// one library in two versions and one of them gets dropped.
#[derive(Default)]
struct ClasspathStats {
    added: usize,
    replaced: usize,
    excluded_by_rules: usize,
    skipped: usize,
}

pub struct ClasspathBuilder {
    entries: Vec<String>,
    libraries: Vec<LibraryEntry>,
    stats: ClasspathStats,
    /// Coordinate key -> index into `libraries`. Entries are replaced in place and never
    /// removed, so the indices stay valid.
    library_index: HashMap<String, usize>,
    custom_client_jar_path: Option<PathBuf>,
    vanilla_client_jar: Option<PathBuf>,
}

impl ClasspathBuilder {
    pub fn new(minecraft_version: &str) -> Self {
        let client_jar = LAUNCHER_DIRECTORY
            .meta_dir()
            .join("versions")
            .join(minecraft_version)
            .join(format!("{}.jar", minecraft_version));
        trace!(
            "Adding vanilla client jar to classpath: {}",
            client_jar.to_string_lossy()
        );

        Self {
            entries: Vec::new(),
            libraries: Vec::new(),
            stats: ClasspathStats::default(),
            library_index: HashMap::new(),
            custom_client_jar_path: None,
            vanilla_client_jar: Some(client_jar),
        }
    }

    /// A known coordinate is replaced in place so its original position survives. Higher
    /// version wins; on a tie the higher priority does, which lets a loader's copy of a
    /// vanilla library take over.
    fn apply_library(&mut self, key: String, path: PathBuf, version: String, priority: u32) {
        if let Some(&index) = self.library_index.get(&key) {
            let existing = &self.libraries[index];
            let replace = match compare_versions(&version, &existing.version) {
                std::cmp::Ordering::Greater => true,
                std::cmp::Ordering::Equal => priority > existing.priority,
                std::cmp::Ordering::Less => false,
            };
            if replace {
                trace!(
                    "🔄 Replacing library {} ({} -> {})",
                    key, existing.version, version
                );
                self.stats.replaced += 1;
                self.libraries[index] = LibraryEntry {
                    path,
                    version,
                    priority,
                };
            } else {
                trace!(
                    "⏩ Skipping library {} (existing version {} is newer or equal to {})",
                    key, existing.version, version
                );
                self.stats.skipped += 1;
            }
            return;
        }

        trace!("✅ Adding library: {} ({})", key, version);
        self.stats.added += 1;
        self.library_index.insert(key, self.libraries.len());
        self.libraries.push(LibraryEntry {
            path,
            version,
            priority,
        });
    }

    pub fn add_piston_libraries(&mut self, libraries: &[Library]) -> &mut Self {
        trace!("=== Processing Vanilla Libraries ===");
        let mut excluded_by_rules: Vec<&str> = Vec::new();
        for lib in libraries {
            if !RuleProcessor::should_include_library(&lib.rules) {
                excluded_by_rules.push(lib.name.as_str());
                self.stats.excluded_by_rules += 1;
                continue;
            }

            let Some(artifact) = &lib.downloads.artifact else {
                trace!("❌ Skipping library without artifact: {}", lib.name);
                self.stats.skipped += 1;
                continue;
            };

            // group:artifact:version[:classifier]
            let parts: Vec<&str> = lib.name.split(':').collect();
            if parts.len() != 3 && parts.len() != 4 {
                info!("❌ Skipping library with invalid format: {}", lib.name);
                self.stats.skipped += 1;
                continue;
            }
            let (group, artifact_name, version) = (parts[0], parts[1], parts[2]);
            let classifier = parts.get(3).copied();

            let relativ_path = artifact.path.clone().unwrap_or_else(|| match classifier {
                Some(c) => format!("{}-{}-{}.jar", artifact_name, version, c),
                None => format!("{}-{}.jar", artifact_name, version),
            });
            let jar_path = LAUNCHER_DIRECTORY
                .meta_dir()
                .join("libraries")
                .join(&relativ_path);

            self.apply_library(
                coordinate_key(group, artifact_name, classifier),
                jar_path,
                version.to_string(),
                0,
            );
        }
        if !excluded_by_rules.is_empty() {
            debug!(
                "Libraries excluded by rules ({}): {}",
                excluded_by_rules.len(),
                excluded_by_rules.join(", ")
            );
        }
        trace!("=== Vanilla Library Processing Complete ===");
        self
    }

    pub fn add_additional_libraries(&mut self, libraries: &[PathBuf], priority: u32) -> &mut Self {
        trace!("=== Processing Additional Libraries ===");
        for library in libraries {
            let Some(file_name) = library.file_name().and_then(|n| n.to_str()) else {
                info!("❌ Skipping library with invalid filename");
                self.stats.skipped += 1;
                continue;
            };
            if !file_name.ends_with(".jar") {
                trace!("❌ Skipping non-jar file: {}", file_name);
                self.stats.skipped += 1;
                continue;
            }

            match coordinate_from_maven_path(library) {
                Some((key, version)) => self.apply_library(key, library.clone(), version, priority),
                None => {
                    // Outside the Maven tree there is no coordinate to trust, so the file name
                    // becomes the identity and the entry is never version-arbitrated. Dropping
                    // it instead would be worse: on Forge 1.21 the client jar carries the
                    // patched Minecraft classes.
                    let base_name = file_name.strip_suffix(".jar").unwrap_or(file_name);
                    trace!("✅ Adding library (non-Maven path): {}", base_name);
                    self.apply_library(
                        base_name.to_string(),
                        library.clone(),
                        String::new(),
                        priority,
                    );
                }
            }
        }
        trace!("=== Additional Library Processing Complete ===");
        self
    }

    pub fn set_custom_client_jar(&mut self, path: PathBuf) -> &mut Self {
        info!("Setting custom client jar: {}", path.to_string_lossy());
        self.custom_client_jar_path = Some(path);
        self
    }

    /// Builds the classpath: libraries in insertion order, Minecraft jar last, so a library
    /// carrying a patched copy of a Minecraft class wins over the jar itself.
    pub fn build(&self) -> String {
        use std::collections::HashSet;

        let mut seen: HashSet<String> = HashSet::new();
        let mut ordered: Vec<String> = Vec::new();

        fn push(path: String, seen: &mut HashSet<String>, out: &mut Vec<String>) {
            let normalized = path.replace("\\", "/");
            if seen.insert(normalized.clone()) {
                out.push(normalized);
            }
        }

        for lib in &self.libraries {
            push(
                lib.path.to_string_lossy().to_string(),
                &mut seen,
                &mut ordered,
            );
        }
        for entry in &self.entries {
            push(entry.clone(), &mut seen, &mut ordered);
        }

        match (&self.custom_client_jar_path, &self.vanilla_client_jar) {
            (Some(custom), _) => {
                debug!("Using custom client jar: {}", custom.display());
                push(custom.to_string_lossy().to_string(), &mut seen, &mut ordered);
            }
            (None, Some(vanilla)) => {
                debug!("Using vanilla client jar: {}", vanilla.display());
                push(
                    vanilla.to_string_lossy().to_string(),
                    &mut seen,
                    &mut ordered,
                );
            }
            (None, None) => {
                info!("⚠️ Warning: No client jar found! This might cause issues.");
            }
        }

        info!(
            "Classpath: {} libraries added, {} excluded by rules, {} replaced, {} skipped -> {} entries",
            self.stats.added,
            self.stats.excluded_by_rules,
            self.stats.replaced,
            self.stats.skipped,
            ordered.len()
        );
        ordered.join(if cfg!(windows) { ";" } else { ":" })
    }
}

fn coordinate_key(group: &str, artifact: &str, classifier: Option<&str>) -> String {
    match classifier.filter(|c| !c.is_empty()) {
        Some(c) => format!("{}:{}:{}", group, artifact, c),
        None => format!("{}:{}", group, artifact),
    }
}

/// Recovers `(coordinate key, version)` from a Maven repository path:
/// `…/libraries/<group as dirs>/<artifact>/<version>/<artifact>-<version>[-<classifier>].jar`.
///
/// This replaces the old "split the file name at the last dash" guess, which could not tell a
/// classifier from a version.
fn coordinate_from_maven_path(path: &Path) -> Option<(String, String)> {
    let libraries_root = LAUNCHER_DIRECTORY.meta_dir().join("libraries");
    let relative = path.strip_prefix(&libraries_root).ok()?;

    let components: Vec<&str> = relative
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()?;
    // group (>=1) + artifact + version + file
    if components.len() < 4 {
        return None;
    }

    let file_stem = components[components.len() - 1].strip_suffix(".jar")?;
    let version = components[components.len() - 2];
    let artifact = components[components.len() - 3];
    let group = components[..components.len() - 3].join(".");

    // A file that does not follow the layout is not safe to arbitrate on.
    let remainder = file_stem.strip_prefix(&format!("{}-{}", artifact, version))?;
    let classifier = remainder.strip_prefix('-').unwrap_or(remainder);

    Some((
        coordinate_key(&group, artifact, Some(classifier)),
        version.to_string(),
    ))
}
