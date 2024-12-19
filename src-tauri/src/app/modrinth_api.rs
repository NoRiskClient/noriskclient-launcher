use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::fs::metadata;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::app::api::{LoaderMod, ModSource};
use crate::HTTP_CLIENT;

/// Placeholder struct for API endpoints implementation
pub struct ModrinthApiEndpoints;

impl ModrinthApiEndpoints {
    pub async fn get_project_members(slug: &str) -> Result<Vec<ModrinthTeamMember>, crate::error::Error> {
        let url = format!("https://api.modrinth.com/v2/project/{}/members", slug);
        Ok(HTTP_CLIENT.get(url)
            .send()
            .await?
            .json::<Vec<ModrinthTeamMember>>()
            .await?)
    }

    pub async fn search_projects<T: DeserializeOwned>(params: &ModrinthSearchRequestParams, custom: Option<HashMap<String, String>>) -> Result<T, crate::error::Error> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&index={}&limit={}&offset={}&query={}{}", params.facets, params.index, params.limit, params.offset, params.query, if custom.is_some() { format!("&{}", custom.unwrap().iter().map(|(key, value)| format!("{}={}", key, value)).collect::<Vec<String>>().join("&") ) } else { "".to_string() });
        Ok(HTTP_CLIENT.get(url)
            .send()
            .await?
            .json::<T>()
            .await?)
    }

    pub async fn get_project<T: DeserializeOwned>(slug_or_id: &str) -> Result<T, crate::error::Error> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        Ok(HTTP_CLIENT.get(url)
            .send()
            .await?
            .json::<T>()
            .await?)
    }

    pub async fn get_project_version(slug: &str, params: &str) -> Result<Vec<ModrinthProject>, crate::error::Error> {
        let url = format!("https://api.modrinth.com/v2/project/{}/version{}", slug, params);
        Ok(HTTP_CLIENT.get(url)
            .send()
            .await?
            .json::<Vec<ModrinthProject>>()
            .await?)
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthTeamMember {
    pub user: ModrinthUser,
    pub role: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthUser {
    pub username: String
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthModsSearchResponse {
    hits: Vec<ModInfo>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthShadersSearchResponse {
    hits: Vec<ShaderInfo>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthResourcePacksSearchResponse {
    hits: Vec<ResourcePackInfo>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthDatapacksSearchResponse {
    hits: Vec<DatapackInfo>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthSearchRequestParams {
    pub facets: String,
    pub index: String,
    pub limit: u32,
    pub offset: u32,
    pub query: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Mod {
    pub slug: String,
    pub title: String,
    pub icon_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ShaderInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Shader {
    pub slug: String,
    pub title: String,
    pub file_name: String,
    pub icon_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ResourcePackInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourcePack {
    pub slug: String,
    pub title: String,
    pub file_name: String,
    pub icon_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DatapackInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Datapack {
    pub slug: String,
    pub title: String,
    pub world_name: String,
    pub file_name: String,
    pub icon_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthProject {
    pub id: String,
    pub project_id: String,
    pub project_type: Option<String>,
    pub author_id: String,
    pub featured: bool,
    pub name: String,
    pub version_number: String,
    pub changelog: String,
    pub changelog_url: Option<String>,
    pub date_published: String,
    pub downloads: u32,
    pub version_type: String,
    pub status: String,
    pub requested_status: Option<String>,
    pub files: Vec<ModrinthFile>,
    pub dependencies: Vec<Dependency>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
}

impl ModrinthProject {
    pub fn to_custom_mod(&self, title: &str, slug: &str, image_url: Option<String>, dependencies: Vec<CustomMod>, required: bool, enabled: bool) -> CustomMod {
        let file_name = self.files.first().map(|file| {
            file.filename.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());
        let repo_artifact = format!("maven.modrinth:{}:{}", slug, self.version_number);
        let url = self.files.first().map(|file| {
            file.url.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());

        return CustomMod {
            title: title.to_string(),
            image_url: image_url,
            value: LoaderMod {
                enabled,
                required,
                name: file_name,
                source: ModSource::Repository {
                    repository: "modrinth".to_string(),
                    artifact: repo_artifact,
                    url: Some(url)
                },
            },
            dependencies,
        };
    }

    pub fn to_loader_mod(&self, slug: &str, required: bool, enabled: bool) -> LoaderMod {
        let file_name = self.files.first().map(|file| {
            file.filename.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());
        let repo_artifact = format!("maven.modrinth:{}:{}", slug, self.version_number);
        let url = self.files.first().map(|file| {
            file.url.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());

        return LoaderMod {
            enabled,
            required,
            name: file_name,
            source: ModSource::Repository {
                repository: "modrinth".to_string(),
                artifact: repo_artifact,
                url: Some(url)
            },
        };
    }


    pub fn to_slug(&self) -> String {
        return self.files.first().map(|file| {
            return file.filename.replace(format!("-{}.jar", self.version_number).as_str(), "");
        }).unwrap_or("ERROR-MOD".to_string());
    }

    pub fn is_already_required_by_norisk_client(&self, mods: &Vec<LoaderMod>) -> bool {
        let dependency_slug = self.to_slug();
        return mods.iter().any(|loader_mod| {
            let slug = loader_mod.source.get_slug();
            return dependency_slug.eq_ignore_ascii_case(&slug);
        });
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthFile {
    pub hashes: Hashes,
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u32,
    pub file_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Hashes {
    pub sha512: String,
    pub sha1: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Dependency {
    pub version_id: Option<String>,
    pub project_id: String,
    pub file_name: Option<String>,
    pub dependency_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomMod {
    pub title: String,
    pub image_url: Option<String>,
    pub value: LoaderMod,
    pub dependencies: Vec<CustomMod>,
}