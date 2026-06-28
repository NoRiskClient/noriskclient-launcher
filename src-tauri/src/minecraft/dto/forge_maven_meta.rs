use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ForgeMavenMetadata {
    #[serde(rename = "versioning")]
    pub versioning: Versioning,
}

#[derive(Debug, Deserialize)]
pub struct Versioning {
    #[serde(rename = "latest")]
    pub latest: String,
    #[serde(rename = "release")]
    pub release: String,
    #[serde(rename = "versions")]
    pub versions: Versions,
}

#[derive(Debug, Deserialize)]
pub struct Versions {
    #[serde(rename = "version")]
    pub versions: Vec<String>,
}

impl ForgeMavenMetadata {
    pub fn get_latest_version(&self) -> &str {
        &self.versioning.latest
    }

    pub fn get_release_version(&self) -> &str {
        &self.versioning.release
    }

    pub fn get_all_versions(&self) -> &[String] {
        &self.versioning.versions.versions
    }

    pub fn get_versions_for_minecraft(&self, minecraft_version: &str) -> Vec<String> {
        // Forge version strings are `MC_VERSION-FORGE_BUILD[-MC_VERSION]`
        // (e.g. "1.21.1-52.1.0", "1.8.9-11.15.1.2318-1.8.9", "26.1.2-64.0.4").
        // Match against the full MC prefix WITH the separator so `"26.1"`
        // never accidentally matches `"26.10-…"` entries once they exist.
        let prefix = format!("{}-", minecraft_version);
        let mut versions: Vec<String> = self.versioning
            .versions
            .versions
            .iter()
            .filter(|v| v.starts_with(&prefix))
            .cloned()
            .collect();

        // Maven ordering is inconsistent across MC versions — legacy (1.7/1.8)
        // is descending, modern (1.21.11) is ascending, and 1.20.1 is literally
        // mixed — so we tuple-parse the FORGE_BUILD segments and sort ourselves.
        // `.first()` is then always the newest build.
        versions.sort_by(|a, b| parse_forge_build(b, &prefix).cmp(&parse_forge_build(a, &prefix)));
        versions
    }

    pub fn get_latest_version_for_minecraft(&self, minecraft_version: &str) -> Option<String> {
        self.get_versions_for_minecraft(minecraft_version)
            .into_iter()
            .next()
    }
}

// Split the FORGE_BUILD part (strip MC prefix + optional trailing MC suffix)
// into its numeric components. Non-numeric segments fall back to 0.
fn parse_forge_build(version: &str, mc_prefix: &str) -> Vec<u32> {
    let rest = version.strip_prefix(mc_prefix).unwrap_or(version);
    let build = rest.split('-').next().unwrap_or(rest);
    build.split('.').map(|s| s.parse::<u32>().unwrap_or(0)).collect()
}
