use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeoForgeMavenMetadata {
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

impl NeoForgeMavenMetadata {
    /// Merges the version list from `other` into `self`, deduplicating entries.
    /// `self` (releases) fields are kept for `latest` and `release`.
    pub fn merge_with(mut self, other: Self) -> Self {
        for v in other.versioning.versions.versions {
            if !self.versioning.versions.versions.contains(&v) {
                self.versioning.versions.versions.push(v);
            }
        }
        self
    }

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
        let mut versions: Vec<String> = self.versioning
            .versions
            .versions
            .iter()
            .filter(|v| {
                if let Some(parsed_mc_version) = Self::parse_neoforge_version_to_minecraft(v) {
                    parsed_mc_version == minecraft_version
                } else {
                    false
                }
            })
            .cloned()
            .collect();
        
        // Reverse to get newest first (Maven metadata is chronological, oldest to newest)
        versions.reverse();
        versions
    }

    pub fn get_latest_version_for_minecraft(&self, minecraft_version: &str) -> Option<String> {
        // After reverse, first element is the newest
        self.get_versions_for_minecraft(minecraft_version)
            .into_iter()
            .next()
    }

    pub fn parse_neoforge_version_to_minecraft(neoforge_version: &str) -> Option<String> {
        let parts: Vec<&str> = neoforge_version.split('.').collect();

        if parts.is_empty() {
            return None;
        }

        match parts[0].parse::<u32>() {
            Ok(p1) => {
                if p1 > 0 {
                    // Release/Beta logic
                    if parts.len() < 2 {
                        return None; // Need at least p1 and p2
                    }
                    match parts[1].parse::<u32>() {
                        Ok(p2) => {
                            if p2 > 0 {
                                Some(format!("1.{}.{}", p1, p2))
                            } else {
                                Some(format!("1.{}", p1))
                            }
                        }
                        Err(_) => None, // p2 is not a number
                    }
                } else {
                    // p1 == 0, Snapshot/Custom logic
                    if parts.len() > 1 {
                        Some(parts[1].to_string())
                    } else {
                        None // Need at least two parts for snapshot logic
                    }
                }
            }
            Err(_) => None, // p1 is not a number
        }
    }

    pub fn print_parsed_versions(&self) {
        log::info!("NeoForge Version -> Parsed Minecraft Version:");
        for neoforge_version in &self.versioning.versions.versions {
            let parsed_mc_version = Self::parse_neoforge_version_to_minecraft(neoforge_version);
            log::info!(
                "  {} -> {}",
                neoforge_version,
                parsed_mc_version.as_deref().unwrap_or("Parse Failed")
            );
        }
    }
}
