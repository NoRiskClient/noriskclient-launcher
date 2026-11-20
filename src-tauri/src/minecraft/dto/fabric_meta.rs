use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricLoaderVersion {
    pub separator: String,
    pub build: i32,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricIntermediary {
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct FabricLibrary {
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
pub struct FabricLibraries {
    pub client: Vec<FabricLibrary>,
    pub common: Vec<FabricLibrary>,
    pub server: Vec<FabricLibrary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub development: Option<Vec<FabricLibrary>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricMainClassObject {
    #[serde(rename = "client")]
    pub client: String,
    #[serde(rename = "server")]
    pub server: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FabricMainClass {
    String(String),
    Object(FabricMainClassObject),
}

impl FabricMainClass {
    pub fn get_client(&self) -> String {
        match self {
            FabricMainClass::String(s) => s.clone(),
            FabricMainClass::Object(o) => o.client.clone(),
        }
    }

}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricLauncherMeta {
    pub version: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_java_version: Option<i32>,
    pub libraries: FabricLibraries,
    #[serde(rename = "mainClass")]
    pub main_class: FabricMainClass,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricVersionInfo {
    pub loader: FabricLoaderVersion,
    pub intermediary: FabricIntermediary,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: FabricLauncherMeta,
}
