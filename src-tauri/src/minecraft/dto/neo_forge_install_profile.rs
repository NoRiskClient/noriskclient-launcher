use serde::Deserialize;
use std::collections::HashMap;

use super::neo_forge_meta::NeoForgeLibrary;

#[derive(Debug, Deserialize)]
pub struct NeoForgeInstallProfile {
    pub data: HashMap<String, NeoForgeDataEntry>,
    pub processors: Vec<NeoForgeProcessor>,
    pub libraries: Vec<NeoForgeLibrary>,
}

#[derive(Debug, Deserialize)]
pub struct NeoForgeDataEntry {
    pub client: String,
    pub server: String,
}

#[derive(Debug, Deserialize)]
pub struct NeoForgeProcessor {
    pub sides: Option<Vec<String>>,
    pub jar: String,
    pub classpath: Option<Vec<String>>,
    pub args: Option<Vec<String>>,
    pub outputs: Option<HashMap<String, String>>,
}
