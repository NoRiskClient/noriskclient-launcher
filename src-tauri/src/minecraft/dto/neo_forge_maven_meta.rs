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

        let p1 = parts[0].parse::<u32>().ok()?;

        // p1 == 0: snapshot/custom form like "0.25w14craftmine" — the next
        // segment IS the MC version ID.
        if p1 == 0 {
            return parts.get(1).map(|s| s.to_string());
        }

        if parts.len() < 2 {
            return None;
        }
        let p2 = parts[1].parse::<u32>().ok()?;

        // Minecraft dropped the "1." prefix with the "26.x" line. NeoForge
        // mirrors this: versions 20.x–21.x follow the OLD scheme
        // (`X.Y.Z` → MC `1.X.Y`), while 22+ follow the NEW scheme
        // (`X.Y.Z.W` → MC `X.Y.Z`). The threshold sits between 21 (last
        // "1.21.*" release) and 26 (first non-"1." release — see
        // piston-meta manifest ids like "26.1", "26.1.1", "26.1.2").
        if p1 <= 21 {
            // OLD: 1.X.Y mapping.
            if p2 > 0 {
                Some(format!("1.{}.{}", p1, p2))
            } else {
                Some(format!("1.{}", p1))
            }
        } else {
            // NEW: X.Y.Z mapping. Third segment is the MC patch (or absent
            // for pre-releases like "26.1.0.x" → MC "26.1").
            let p3 = parts.get(2).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            if p3 > 0 {
                Some(format!("{}.{}.{}", p1, p2, p3))
            } else {
                Some(format!("{}.{}", p1, p2))
            }
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
