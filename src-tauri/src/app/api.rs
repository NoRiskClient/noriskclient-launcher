use std::borrow::Cow;
use std::collections::BTreeMap;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};
use serde::de::DeserializeOwned;
use tauri::http::header::{ACCEPT, CONTENT_TYPE};
use tracing::{debug, info};

use crate::HTTP_CLIENT;
use crate::utils::get_maven_artifact_path;

/// API endpoint url
pub const NORISK_LAUNCHER_API: &str = "https://api.norisk.gg";
pub const NORISK_LAUNCHER_API_VERSION: &str = "launcherapi/v1";

pub const CONTENT_FOLDER: &str = "NoRiskClient";

/// Placeholder struct for API endpoints implementation
pub struct ApiEndpoints;

impl ApiEndpoints {
    /// Request all available branches
    pub async fn norisk_branches() -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint("branches").await
    }

    /// Request all available branches
    pub async fn auth_prepare_response() -> Result<AuthPrepareResponse> {
        Self::post_from_norisk_endpoint("auth/prepare").await
    }

    /// Request all available branches
    pub async fn refresh_token(body: &str) -> Result<MinecraftToken> {
        Self::post_from_refresh_endpoint("auth/rust_refresh_only", body).await
    }

    /// Request all available branches
    pub async fn await_auth_response(id: u32) -> Result<LoginData> {
        Self::post_from_await_endpoint("auth/await", id).await
    }

    /// Request launch manifest of specific build
    pub async fn launch_manifest(branch: &str) -> Result<NoRiskLaunchManifest> {
        Self::request_from_norisk_endpoint(&format!("version/launch/{}", branch)).await
    }

    /// Request download of specified JRE for specific OS and architecture
    pub async fn jre(os_name: &String, os_arch: &String, jre_version: u32) -> Result<JreSource> {
        Self::request_from_norisk_endpoint(&format!("version/jre/{}/{}/{}", os_name, os_arch, jre_version)).await
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str) -> Result<T> {
        let url = format!("{}/{}/{}", NORISK_LAUNCHER_API, NORISK_LAUNCHER_API_VERSION, endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str) -> Result<T> {
        let url = format!("{}/{}/{}", "https://api.hglabor.de", "api/v1", endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    pub async fn post_from_refresh_endpoint<T: DeserializeOwned>(endpoint: &str, request_body: &str) -> Result<T> {
        let url = format!("{}/{}/{}", "https://api.hglabor.de", "api/v1", endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .body(request_body.to_string())
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_await_endpoint<T: DeserializeOwned>(endpoint: &str, id: u32) -> Result<T> {
        let url = format!("{}/{}/{}?{}={}", "https://api.hglabor.de", "api/v1", endpoint, "id", id);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }
}

#[derive(Serialize, Deserialize)]
pub struct Branches {
    #[serde(rename = "defaultBranch")]
    pub default_branch: String,
    pub branches: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Changelog {
    pub build: Build,
    pub changelog: String,
}

#[derive(Debug, Deserialize)]
pub struct AuthPrepareResponse {
    pub id: u32,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct AuthTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoginData {
    #[serde(rename = "mcToken")]
    pub mc_token: String,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    pub uuid: String,
    pub username: String,
    #[serde(rename = "noriskToken")]
    pub norisk_token: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MinecraftToken {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    pub uuid: String,
    //pub duration: u32,
}

impl LoginData {
    /// Refresh access token if necessary
    pub async fn refresh(self) -> Result<LoginData> {
        debug!("Refreshing auth via norisk...");
        match ApiEndpoints::refresh_token(&self.refresh_token).await {
            Ok(response) => {
                debug!("Refreshed auth...");
                Ok(LoginData {
                    uuid: self.uuid, //iwie returned response eine andere UUID XD?
                    access_token: response.access_token,
                    refresh_token: self.refresh_token,
                    username: self.username,
                    norisk_token: self.norisk_token,
                    mc_token: self.mc_token,
                })
            }
            Err(err) => {
                Err(err)
            }
        }
    }
}

///
/// JSON struct of Build
///
#[derive(Debug, Serialize, Deserialize)]
pub struct NoRiskBuild {
    pub branch: String,
    #[serde(rename(serialize = "mcVersion"))]
    pub mc_version: String,
    #[serde(rename(serialize = "jreVersion"))]
    pub jre_version: u32,
    #[serde(rename(serialize = "fabricLoaderVersion"))]
    pub fabric_loader_version: String,
}

///
/// JSON struct of Build
///
#[derive(Debug, Serialize, Deserialize)]
pub struct Build {
    #[serde(rename(serialize = "buildId"))]
    pub build_id: u32,
    #[serde(rename(serialize = "commitId"))]
    pub commit_id: String,
    pub branch: String,
    pub subsystem: String,
    #[serde(rename(serialize = "lbVersion"))]
    pub lb_version: String,
    #[serde(rename(serialize = "mcVersion"))]
    pub mc_version: String,
    pub release: bool,
    pub date: DateTime<Utc>,
    pub message: String,
    pub url: String,
    #[serde(rename(serialize = "jreVersion"))]
    pub jre_version: u32,
    #[serde(flatten)]
    pub subsystem_specific_data: SubsystemSpecificData,
}

///
/// Subsystem specific data
/// This can be used for any subsystem, but for now it is only implemented for Fabric.
/// It has to be turned into a Enum to be able to decide on it's own for specific data, but for now this is not required.
///
#[derive(Debug, Serialize, Deserialize)]
pub struct SubsystemSpecificData {
    // Additional data
    #[serde(rename(serialize = "fabricApiVersion"))]
    pub fabric_api_version: String,
    #[serde(rename(serialize = "fabricLoaderVersion"))]
    pub fabric_loader_version: String,
    #[serde(rename(serialize = "kotlinVersion"))]
    pub kotlin_version: String,
    #[serde(rename(serialize = "kotlinModVersion"))]
    pub kotlin_mod_version: String,
}

///
/// JSON struct of Launch Manifest
///
#[derive(Serialize, Deserialize, Debug)]
pub struct NoRiskLaunchManifest {
    pub build: NoRiskBuild,
    pub subsystem: LoaderSubsystem,
    pub mods: Vec<LoaderMod>,
    pub repositories: BTreeMap<String, String>,
}

///
/// JSON struct of Launch Manifest
///
#[derive(Deserialize, Debug)]
pub struct LaunchManifest {
    pub build: Build,
    pub subsystem: LoaderSubsystem,
    pub mods: Vec<LoaderMod>,
    pub repositories: BTreeMap<String, String>,
}

///
/// JSON struct of mod
///
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LoaderMod {
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    #[serde(alias = "default")]
    pub enabled: bool,
    pub name: String,
    pub source: ModSource,
}

impl LoaderMod {
    pub fn is_same_slug(&self, other: &LoaderMod) -> bool {
        return self.source.get_slug().eq_ignore_ascii_case(&other.source.get_slug())
    }
}

///
/// JSON struct of ModSource (the method to be used for downloading the mod)
///
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum ModSource {
    #[serde(rename = "repository")]
    #[serde(rename_all = "camelCase")]
    Repository { repository: String, artifact: String, url: Option<String> },
}

impl ModSource {
    pub fn get_slug(&self) -> String {
        match self {
            ModSource::Repository { repository: _repository, artifact, url } => {
                let parts: Vec<&str> = artifact.split(":").collect();
                if parts.len() > 1 {
                    parts[1].to_string()
                } else {
                    "".to_string()
                }
            }
            _ => { "".to_string() }
        }
    }

    pub fn get_path(&self) -> Result<String> {
        Ok(
            match self {
                ModSource::Repository { repository: _repository, artifact, url } => get_maven_artifact_path(artifact)?,
                _ => { "".to_string() }
            }
        )
    }
}

///
/// JSON struct of subsystem
///
#[derive(Deserialize, Serialize, Debug)]
#[serde(tag = "name")]
pub enum LoaderSubsystem {
    #[serde(rename = "fabric")]
    Fabric { manifest: String, mod_directory: String },
    #[serde(rename = "forge")]
    Forge { manifest: String, mod_directory: String },
}

///
/// JSON struct of JRE source
///
#[derive(Deserialize)]
pub struct JreSource {
    pub version: u32,
    pub download_url: String,
}
