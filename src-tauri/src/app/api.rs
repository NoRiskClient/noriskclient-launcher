use std::collections::{BTreeMap, HashMap};

use anyhow::Result;
use chrono::{DateTime, Utc};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;

use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::app::gui::minecraft_auth_get_default_user;
use super::app_data::{Announcement, ChangeLog, LauncherOptions};
use crate::custom_servers::models::CustomServer;
use crate::error::ErrorKind;
use crate::minecraft::minecraft_auth::NoRiskToken;
use crate::minecraft::version::AssetObject;
use crate::utils::get_maven_artifact_path;

pub const CONTENT_FOLDER: &str = "NoRiskClient";

/// Placeholder struct for API endpoints implementation
pub struct ApiEndpoints;

pub fn get_api_base(is_experimental: bool) -> String {
    return if is_experimental {
        String::from("https://api-staging.norisk.gg/api/v1")
    } else {
        String::from("https://api.norisk.gg/api/v1")
    };
}

impl ApiEndpoints {
    /// Check API status
    pub async fn norisk_api_status() -> Result<bool> {
        let core = Self::request_from_norisk_endpoint("core/online", "", "").await.unwrap_or(false);
        let launcher = Self::request_from_norisk_endpoint("launcher/online", "", "").await.unwrap_or(false);
        info!("Core API online state: {}, Launcher API online state: {}", core, launcher);
        Ok(core && launcher)
    }

    /// Request maintenance mode
    pub async fn get_norisk_user(norisk_token: &str, request_uuid: &str) -> Result<NoRiskUserMinimal> {
        Self::request_from_norisk_endpoint("core/user", norisk_token, request_uuid).await
    }
    
    /// Request maintenance mode
    pub async fn norisk_maintenance_mode() -> Result<bool> {
        Self::request_from_norisk_endpoint("launcher/maintenance-mode", "", "").await
    }

    /// Request all available branches
    pub async fn norisk_branches(norisk_token: &str, request_uuid: &str) -> core::result::Result<Vec<String>, crate::error::Error> {
        Self::request_from_norisk_endpoint_with_error_handling("launcher/branches", norisk_token, request_uuid).await
    }

    /// Request all available branches
    pub async fn norisk_full_feature_whitelist(norisk_token: &str, request_uuid: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint("core/whitelist/features", norisk_token, request_uuid).await
    }
    
    /// Request all available branches
    pub async fn norisk_feature_whitelist(feature: &str, norisk_token: &str, request_uuid: &str) -> Result<bool> {
        Self::request_from_norisk_endpoint(format!("core/whitelist/feature/{}", feature).as_str(), norisk_token, request_uuid).await
    }

    /// Request token for experimental mode
    pub async fn enable_experimental_mode(norisk_token: &str, request_uuid: &str) -> Result<String> {
        let url = format!("{}/{}", get_api_base(false), "launcher/experimental-mode");
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }

    /// Request featured mods
    pub async fn norisk_featured_mods(branch: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/featured/{}/mods", branch), "", "").await
    }

    /// Request featured resourcepacks
    pub async fn norisk_featured_resourcepacks(branch: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/featured/{}/resourcepacks", branch), "", "").await
    }

    /// Request featured shaders
    pub async fn norisk_featured_shaders(branch: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/featured/{}/shaders", branch), "", "").await
    }

    /// Request featured datapacks
    pub async fn norisk_featured_datapacks(branch: &str) -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/featured/{}/datapacks", branch), "", "").await
    }

    /// Request featured servers
    pub async fn norisk_featured_servers(branch: &str) -> Result<Vec<FeaturedServer>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/featured/{}/servers", branch), "", "").await
    }

    /// Request blacklisted mods
    pub async fn norisk_blacklisted_mods() -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/blacklisted/mods"), "", "").await
    }

    /// Request blacklisted resourcepacks
    pub async fn norisk_blacklisted_resourcepacks() -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/blacklisted/resourcepacks"), "", "").await
    }

    /// Request blacklisted shaders
    pub async fn norisk_blacklisted_shaders() -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/blacklisted/shaders"), "", "").await
    }

    /// Request blacklisted datapacks
    pub async fn norisk_blacklisted_datapacks() -> Result<Vec<String>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/blacklisted/datapacks"), "", "").await
    }

    /// Request blacklisted servers
    pub async fn norisk_blacklisted_servers() -> Result<Vec<FeaturedServer>> {
        Self::request_from_norisk_endpoint(&*format!("launcher/blacklisted/servers"), "", "").await
    }

    /// Request custom servers
    pub async fn norisk_custom_servers(token: &str, request_uuid: &str) -> Result<CustomServersResponse> {
        Self::request_from_norisk_endpoint("launcher/custom-servers", token, request_uuid).await
    }

    /**
    In diesem Fall ist es nicht der NoRiskToken sondern der Minecraft Token!!
     */
    pub async fn refresh_norisk_token(token: &str) -> Result<NoRiskToken> {
        Self::post_from_norisk_endpoint("launcher/auth/validate", token, "").await
    }

    /// Check subdomain
    pub async fn norisk_check_custom_server_subdomain(subdomain: &str, token: &str, request_uuid: &str) -> Result<bool> {
        Self::request_from_norisk_endpoint(&format!("launcher/custom-servers/check-subdomain?subdomain={}", subdomain), token, request_uuid).await
    }

    /// Get JWT token
    pub async fn norisk_get_custom_server_jwt_token(custom_server_id: &str, token: &str, request_uuid: &str) -> Result<String> {
        Self::request_from_norisk_endpoint(&format!("launcher/custom-servers/{}/token", custom_server_id), token, request_uuid).await
    }

    /// Create custom server
    pub async fn norisk_create_custom_server(name: &str, mc_version: &str, loader_version: Option<&str>, r#type: &str, subdomain: &str, token: &str, request_uuid: &str) -> Result<CustomServer> {
        Self::post_from_norisk_endpoint_with_body("launcher/custom-servers", CreateCustomServerRequest { name: name.to_owned(), mc_version: mc_version.to_owned(), loader_version: loader_version.map(|s| s.to_owned()), r#type: r#type.to_owned(), subdomain: subdomain.to_owned() }, token, request_uuid).await
    }

    /// Delete custom server
    pub async fn norisk_delete_custom_server(server_id: &str, token: &str, request_uuid: &str) -> Result<()> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), format!("launcher/custom-servers/{}", server_id));
        info!("URL: {}", url); // Den formatierten String ausgeben
        HTTP_CLIENT.delete(url)
            .header("Authorization", format!("Bearer {}", token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?;
        Ok(())
    }

    /// Request all available branches
    pub async fn auth_prepare_response() -> Result<AuthPrepareResponse> {
        Self::post_from_norisk_endpoint("core/auth/prepare", "", "").await
    }

    /// Request all available branches
    pub async fn refresh_token(body: &str) -> Result<MinecraftToken> {
        Self::post_from_norisk_endpoint_with_body("core/auth/rust_refresh_only", body, "", "").await
    }

    pub async fn refresh_token_maybe_fixed(body: &str) -> Result<RefreshResponse> {
        Self::post_from_norisk_endpoint_with_body("core/auth/rust_refresh_only", body, "", "").await
    }

    /// Request all available branches
    pub async fn await_auth_response(id: u32) -> Result<LoginData> {
        Self::post_from_await_endpoint("core/auth/await", id).await
    }

    /// Request launch manifest of specific build
    pub async fn launch_manifest(branch: &str) -> core::result::Result<NoRiskLaunchManifest, crate::error::Error> {
        Self::request_from_noriskclient_endpoint(&format!("launcher/version/launch/{}", branch)).await
    }

    /// Request download of specified JRE for specific OS and architecture
    pub async fn jre(os_name: &String, os_arch: &String, jre_version: u32) -> Result<JreSource> {
        Self::request_from_norisk_endpoint(&format!("launcher/version/jre/{}/{}/{}", os_name, os_arch, jre_version), "", "").await
    }

    /// Request norisk assets json for specific branch
    pub async fn norisk_assets(branch: String, norisk_token: &str, request_uuid: &str) -> Result<NoriskAssets> {
        Self::request_from_norisk_endpoint(&format!("launcher/assets/{}", branch), norisk_token, request_uuid).await
    }

    /// Request changelogs
    pub async fn changelogs() -> Result<Vec<ChangeLog>> {
        Self::request_from_download_norisk_endpoint("launcher_popups/changelogs.json").await
    }

    /// Request announcements
    pub async fn announcements() -> Result<Vec<Announcement>> {
        Self::request_from_download_norisk_endpoint("launcher_popups/announcements.json").await
    }

    /// Request mcreal app token
    pub async fn get_mcreal_app_token(norisk_token: &str, request_uuid: &str) -> Result<String> {
        // BRUDER WIESO GEHT DAS HIER NT MIT DEM JSON PARSEN ABER OEBN SCHON!?!?!? Aber egal, brauchen eh nur String also von mir aus dann halt so :(
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), "mcreal/user/mobileAppToken");
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }

    /// Reset mcreal app token
    pub async fn reset_mcreal_app_token(norisk_token: &str, request_uuid: &str) -> Result<String> {
        // BRUDER WIESO GEHT DAS HIER NT MIT DEM JSON PARSEN ABER OEBN SCHON!?!?!? Aber egal, brauchen eh nur String also von mir aus dann halt so :(
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), "mcreal/user/mobileAppToken/reset");
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }

    /// Request discord link status
    pub async fn discord_link_status(norisk_token: &str, request_uuid: &str) -> Result<bool> {
        Self::request_from_norisk_endpoint("core/oauth/discord/check", norisk_token, request_uuid).await
    }

    /// Request discord link status
    pub async fn unlink_discord(norisk_token: &str, request_uuid: &str) -> Result<String> {
        Self::delete_from_norisk_endpoint_text("core/oauth/discord/unlink", norisk_token, request_uuid).await
    }

    /// Request whitelist slots
    pub async fn whitelist_slots(norisk_token: &str, request_uuid: &str) -> Result<WhitelistSlots> {
        Self::request_from_norisk_endpoint("core/whitelist/slots", norisk_token, request_uuid).await
    }

    /// Add user to whitelist
    pub async fn whitelist_add_user(uuid: &str, norisk_token: &str, request_uuid: &str) -> Result<bool> {
        Self::post_from_norisk_endpoint(&format!("core/whitelist/invite/{}", uuid), norisk_token, request_uuid).await
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str, norisk_token: &str, request_uuid: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    //TODO lol rename die methode wenn wir aufräumen
    pub async fn request_from_norisk_endpoint_with_error_handling<T: DeserializeOwned>(endpoint: &str, norisk_token: &str, request_uuid: &str) -> core::result::Result<T, crate::error::Error> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_noriskclient_endpoint<T: DeserializeOwned>(endpoint: &str) -> core::result::Result<T, crate::error::Error> {
        let credentials = minecraft_auth_get_default_user().await?.ok_or(ErrorKind::NoCredentialsError)?;
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        //TODO brauchen wir das wirklich? diesen token also zukünftig
        let token = if options.experimental_mode {
            credentials.norisk_credentials.experimental.ok_or(ErrorKind::NoCredentialsError)?
        } else {
            credentials.norisk_credentials.production.ok_or(ErrorKind::NoCredentialsError)?
        };
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", token.value))
            .query(&[("uuid", credentials.id)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    // brachen wir für experimental token request, der immer auf experimental endpoint geht
    pub async fn request_from_norisk_endpoint_with_experimental<T: DeserializeOwned>(endpoint: &str, norisk_token: &str, request_uuid: &str) -> Result<T> {
        let url = format!("{}/{}", get_api_base(true), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_download_norisk_endpoint<T: DeserializeOwned>(endpoint: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("https://dl{}.norisk.gg/{}", if options.experimental_mode { "-staging" } else { "" }, endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str, norisk_token: &str, request_uuid: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_norisk_endpoint_with_body<T: DeserializeOwned, B: Serialize>(endpoint: &str, body: B, norisk_token: &str, request_uuid: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .json(&body)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn delete_from_norisk_endpoint<T: DeserializeOwned>(endpoint: &str, norisk_token: &str, request_uuid: &str) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }

    /// Request **TEXT** formatted data from launcher API
    pub async fn delete_from_norisk_endpoint_text(endpoint: &str, norisk_token: &str, request_uuid: &str) -> Result<String> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}", get_api_base(options.experimental_mode), endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send().await?
            .error_for_status()?
            .text()
            .await?
        )
    }

    /// Request JSON formatted data from launcher API
    pub async fn post_from_await_endpoint<T: DeserializeOwned>(endpoint: &str, id: u32) -> Result<T> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let url = format!("{}/{}?{}={}", get_api_base(options.experimental_mode), endpoint, "id", id);
        info!("URL: {}", url); // Den formatierten String ausgeben
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
pub struct FeaturedServer {
    pub name: String,
    pub description: String,
    #[serde(rename = "iconUrl")]
    pub icon_url: String,
    pub ip: String,
    pub port: u16,
    #[serde(rename = "supportsNoRiskClientFeatures")]
    pub supports_nrc_features: bool,
}

#[derive(Serialize, Deserialize)]
pub struct CustomServersResponse {
    pub limit: i32,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub servers: Vec<CustomServer>,
}

//TODO andere attribute bei bedarf adden
#[derive(Serialize, Deserialize, Debug)]
pub struct NoRiskUser {
    pub uuid: String,
    pub token: String,
    pub ign: String,
    #[serde(rename = "discordId")]
    pub discord_id: Option<String>,
    pub rank: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct NoRiskUserMinimal {
    pub uuid: String,
    pub ign: String,
    #[serde(rename = "discordId")]
    pub discord_id: Option<String>,
    pub rank: String,
}

#[derive(Serialize, Deserialize)]
pub struct CreateCustomServerRequest {
    pub name: String,
    #[serde(rename = "mcVersion")]
    pub mc_version: String,
    #[serde(rename = "loaderVersion")]
    pub loader_version: Option<String>,
    pub r#type: String,
    pub subdomain: String,
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
    pub username: String,
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
                debug!("Refreshed auth...");
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
    pub server: String,
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
                if parts[0] == "CUSTOM" {
                    parts[2].to_string()
                } else if parts.len() > 1 {
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

///
/// JSON struct of norisk whitelist slots
///
#[derive(Serialize, Deserialize)]
pub struct WhitelistSlots {
    #[serde(rename = "availableSlots")]
    pub available_slots: i32,
    #[serde(rename = "previousInvites")]
    pub previous_invites: u32,
}