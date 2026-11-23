use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltVersion {
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltLoaderVersion {
    pub separator: String,
    pub build: i32,
    pub maven: String,
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltInstallerVersion {
    pub url: String,
    pub maven: String,
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltVersionManifest {
    pub loader: QuiltLoaderVersion,
    pub installer: QuiltInstallerVersion,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltIntermediary {
    pub maven: String,
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct QuiltLibrary {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub md5: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha512: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltLibraries {
    pub client: Vec<QuiltLibrary>,
    pub common: Vec<QuiltLibrary>,
    pub server: Vec<QuiltLibrary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub development: Option<Vec<QuiltLibrary>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltMainClassObject {
    #[serde(rename = "client")]
    pub client: String,
    #[serde(rename = "server")]
    pub server: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum QuiltMainClass {
    String(String),
    Object(QuiltMainClassObject),
}

impl QuiltMainClass {
    pub fn get_client(&self) -> String {
        match self {
            QuiltMainClass::String(s) => s.clone(),
            QuiltMainClass::Object(o) => o.client.clone(),
        }
    }

}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltLauncherMeta {
    pub version: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_java_version: Option<i32>,
    pub libraries: QuiltLibraries,
    #[serde(rename = "mainClass")]
    pub main_class: QuiltMainClass,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltVersionInfo {
    pub loader: QuiltLoaderVersion,
    pub intermediary: QuiltIntermediary,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: QuiltLauncherMeta,
}
