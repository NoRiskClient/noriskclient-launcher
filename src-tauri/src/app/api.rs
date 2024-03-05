use std::collections::{BTreeMap, HashMap};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tracing::debug;

use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::app::app_data::LauncherOptions;
use crate::minecraft::version::AssetObject;
use crate::utils::get_maven_artifact_path;

/// API endpoint url
pub const NORISK_LAUNCHER_API_VERSION: &str = "launcherapi/v1";

pub const CONTENT_FOLDER: &str = "NoRiskClient";

/// Placeholder struct for API endpoints implementation
pub struct ApiEndpoints;

pub fn get_launcher_api_base(is_experimental: bool) -> String {
    return if is_experimental {
        String::from("https://api-staging.norisk.gg")
    } else {
        String::from("https://api.norisk.gg")
    };
}

impl ApiEndpoints {
    /// Request all available branches
    pub async fn norisk_branches(is_experimental: bool, norisk_token: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint_with_experimental("branches", is_experimental, norisk_token).await
    }

    /// Request token for experimental mode
    pub async fn enable_experimental_mode(experimental_token: &str) -> Result<bool> {
        Self::request_from_norisk_endpoint_with_experimental("experimental-mode", true, experimental_token).await
    }

    /// Request featured mods
    pub async fn norisk_featured_mods(branch: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("featured-mods/{}", branch), "").await
    }

    /// Request all available branches
    pub async fn auth_prepare_response(is_experimental: bool) -> Result<AuthPrepareResponse> {
        Self::post_from_norisk_endpoint_with_experimental("auth/prepare", is_experimental, "").await
    }

    /// Request all available branches
    pub async fn refresh_token(body: &str) -> Result<MinecraftToken> {
        Self::post_from_refresh_endpoint("auth/rust_refresh_only", body).await
    }

    pub async fn refresh_token_maybe_fixed(body: &str) -> Result<RefreshResponse> {
        Self::post_from_refresh_endpoint("auth/rust_refresh_only", body).await
    }

    /// Request all available branches
    pub async fn await_auth_response(is_experimental: bool, id: u32) -> Result<LoginData> {
        Self::post_from_await_endpoint_with_experimental("auth/await", is_experimental, id).await
    }

    /// Request launch manifest of specific build
    pub async fn launch_manifest(branch: &str, norisk_token: &str) -> Result<NoRiskLaunchManifest> {
        Self::request_from_norisk_endpoint(&format!("version/launch/{}", branch), norisk_token).await
    }

    /// Request download of specified JRE for specific OS and architecture
    pub async fn jre(os_name: &String, os_arch: &String, jre_version: u32) -> Result<JreSource> {
        Self::request_from_norisk_endpoint(&format!("version/jre/{}/{}/{}", os_name, os_arch, jre_version), "").await
    }

    /// Request norisk assets json for specific branch
    pub async fn norisk_assets(branch: String, norisk_token: &str) -> Result<NoriskAssets> {
        Self::request_from_norisk_endpoint(&format!("assets/{}", branch), norisk_token).await
    }
    
    /// Request mcreal app token
    pub async fn get_mcreal_app_token(norisk_token: &str, uuid: &str, is_experimental: bool) -> Result<String> {
        Self::request_from_mcreal_endpoint_with_experimental(&format!("user/mobileAppToken?uuid={}", uuid), is_experimental, norisk_token).await
    }
    
    /// Reset mcreal app token
    pub async fn reset_mcreal_app_token(norisk_token: &str, uuid: &str, is_experimental: bool) -> Result<String> {
        Self::post_from_mcreal_endpoint_with_experimental(&format!("user/mobileAppToken/reset?uuid={}", uuid), is_experimental, norisk_token).await
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str, norisk_token: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}/{}", get_launcher_api_base(options.experimental_mode), NORISK_LAUNCHER_API_VERSION, endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    //habe das angelegt weil in javascript wurde es schon geändert aber hier ist noch anderer wert?
    pub async fn request_from_norisk_endpoint_with_experimental<T: DeserializeOwned>(endpoint: &str, is_experimental: bool, norisk_token: &str) -> Result<T> {
        let url = format!("{}/{}/{}", get_launcher_api_base(is_experimental), NORISK_LAUNCHER_API_VERSION, endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }
    
    pub async fn request_from_mcreal_endpoint_with_experimental(endpoint: &str, is_experimental: bool, norisk_token: &str) -> Result<String> {
        let url = format!("{}/mcreal/{}", get_launcher_api_base(is_experimental), endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }
    
    pub async fn post_from_mcreal_endpoint_with_experimental(endpoint: &str, is_experimental: bool, norisk_token: &str) -> Result<String> {
        let url = format!("{}/mcreal/{}", get_launcher_api_base(is_experimental), endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }

    pub async fn post_from_norisk_endpoint_with_experimental<T: DeserializeOwned>(endpoint: &str, is_experimental: bool, norisk_token: &str) -> Result<T> {
        let url = format!("{}/{}/{}", get_launcher_api_base(is_experimental), "api/v1", endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    pub async fn post_from_await_endpoint_with_experimental<T: DeserializeOwned>(endpoint: &str, is_experimental: bool, id: u32) -> Result<T> {
        let url = format!("{}/{}/{}?{}={}", get_launcher_api_base(is_experimental), "api/v1", endpoint, "id", id);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str, norisk_token: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}/{}", get_launcher_api_base(options.experimental_mode), "api/v1", endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    pub async fn post_from_refresh_endpoint<T: DeserializeOwned>(endpoint: &str, request_body: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}/{}", get_launcher_api_base(options.experimental_mode), "api/v1", endpoint);
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
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}/{}?{}={}", get_launcher_api_base(options.experimental_mode), "api/v1", endpoint, "id", id);
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

#[derive(Debug, Deserialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub mc_token: String,
    pub mc_name: String,
    pub norisk_token: String,
}


#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoginData {
    pub uuid: String,
    pub username: String,
    #[serde(rename = "mcToken")]
    pub mc_token: String,
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
    #[serde(rename = "noriskToken")]
    pub norisk_token: String,
    #[serde(rename = "experimentalToken")]
    pub experimental_token: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoginDataMinimal {
    pub uuid: String,
    pub username: String
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

    pub async fn refresh_maybe_fixed(self) -> Result<LoginData> {
        debug!("Refreshing auth via norisk maybe fixed...");
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        match ApiEndpoints::refresh_token_maybe_fixed(&self.refresh_token).await {
            Ok(response) => {
                debug!("Refreshed auth... {:?} ",response);
                Ok(LoginData {
                    uuid: self.uuid,
                    access_token: response.access_token,
                    refresh_token: response.refresh_token,
                    username: response.mc_name,
                    norisk_token: if options.experimental_mode { self.norisk_token } else { response.norisk_token.clone() },
                    experimental_token: if options.experimental_mode { Some(response.norisk_token) } else { self.experimental_token },
                    mc_token: response.mc_token,
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
        return self.source.get_slug().eq_ignore_ascii_case(&other.source.get_slug());
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
            ModSource::Repository { repository: _repository, artifact, url: _ } => {
                let parts: Vec<&str> = artifact.split(":").collect();
                if parts.len() > 1 {
                    parts[1].to_string()
                } else {
                    "".to_string()
                }
            }
        }
    }

    pub fn get_repository(&self) -> String {
        match self {
            ModSource::Repository { repository: _repository, artifact, url: _ } => {
                let parts: Vec<&str> = artifact.split(":").collect();
                if parts.len() > 1 {
                    parts[0].to_string()
                } else {
                    "".to_string()
                }
            }
        }
    }

    pub fn get_path(&self) -> Result<String> {
        Ok(
            match self {
                ModSource::Repository { repository: _repository, artifact, url: _ } => get_maven_artifact_path(artifact)?,
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

///
/// JSON struct of norisk assets json
///
#[derive(Deserialize)]
pub struct NoriskAssets {
    pub objects: HashMap<String, AssetObject>,
}
