use std::error::Error;
#[cfg(target_os = "linux")]
use std::fs::metadata;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::app::api::{LoaderMod, ModSource};
use crate::HTTP_CLIENT;

/// Placeholder struct for API endpoints implementation
pub struct ModrinthApiEndpoints;

impl ModrinthApiEndpoints {
    // PROJECTS
    pub async fn get_project_members(slug: &str) -> Result<Vec<ModrinthTeamMember>, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}/members", slug);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Team Members Request error: {:?}", e))?;
        match response.json::<Vec<ModrinthTeamMember>>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    // MODS
    pub async fn search_mods(params: &ModrinthSearchRequestParams) -> Result<ModrinthModsSearchResponse, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&index={}&limit={}&offset={}&query={}", params.facets, params.index, params.limit, params.offset, params.query);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModrinthModsSearchResponse>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_custom_mod_names(mod_cache_path: &Path) -> anyhow::Result<Vec<String>> {
        tokio::fs::create_dir_all(&mod_cache_path).await?;

        // Copy all mods from custom_mods to mods
        let mut mods_read = tokio::fs::read_dir(&mod_cache_path).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = mods_read.next_entry().await? {
            if entry.file_type().await?.is_file() {
                files.push(entry.file_name().to_str().unwrap().to_string());
            }
        }

        Ok(files)
    }

    pub async fn get_mod_slug(slug_or_id: &str) -> Result<Mod, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<Mod>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_mod_info(slug_or_id: &str) -> Result<ModInfo, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModInfo>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_project_version(slug: &str, params: &str) -> Result<Vec<ModrinthProject>, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}/version{}", slug, params);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<Vec<ModrinthProject>>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    async fn get_dependencies(dependencies: &Vec<Dependency>, params: &str, required_mods: &Vec<LoaderMod>) -> Result<Vec<CustomMod>, Box<dyn Error>> {
        let mut result = Vec::new();

        for dependency in dependencies {
            if dependency.dependency_type == "required" {
                let dependency_mods = ModrinthApiEndpoints::get_project_version(&dependency.project_id, params).await?;
                if let Some(dependency_mod) = dependency_mods.first() {
                    let slug_holder = ModrinthApiEndpoints::get_mod_slug(&dependency.project_id).await?;
                    let required = dependency_mod.is_already_required_by_norisk_client(required_mods);
                    if required {
                        result.push(dependency_mod.to_custom_mod(&dependency_mod.name, &slug_holder.slug, &slug_holder.icon_url, Vec::new(), false, false));
                    } else {
                        result.push(dependency_mod.to_custom_mod(&dependency_mod.name, &slug_holder.slug, &slug_holder.icon_url, Vec::new(), false, true));
                    };
                }
            }
        }

        Ok(result)
    }

    pub async fn install_mod_and_dependencies(slug: &str, version: Option<&str>, params: &str, required_mods: &Vec<LoaderMod>) -> Result<CustomMod, Box<dyn Error>> {
        let mod_project = ModrinthApiEndpoints::get_mod_info(slug).await?;
        let mod_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project = if version.is_some() {
            mod_versions.iter().find(|project| project.version_number == version.unwrap()).ok_or("Mod not found")?
        } else {
            mod_versions.first().ok_or("Mod not found")?
        };
        let dependencies = ModrinthApiEndpoints::get_dependencies(&project.dependencies, params, required_mods).await?;

        Ok(CustomMod {
            title: mod_project.title.clone(),
            image_url: "".to_string(), //Ich setze das einfach in Tauri kein bock
            value: project.to_loader_mod(slug, false, true),
            dependencies,
        })
    }

    // SHADERS
    pub async fn search_shaders(params: &ModrinthSearchRequestParams) -> Result<ModrinthShadersSearchResponse, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&index={}&limit={}&offset={}&query={}", params.facets, params.index, params.limit, params.offset, params.query);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModrinthShadersSearchResponse>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_custom_shader_names(shaders_path: &Path, installed_shaders: &Vec<Shader>) -> anyhow::Result<Vec<String>> {
        tokio::fs::create_dir_all(&shaders_path).await?;

        let mut shaders_read = tokio::fs::read_dir(&shaders_path).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = shaders_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_shaders.iter().any(|shader| shader.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn get_shader_slug(slug_or_id: &str) -> Result<Shader, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Shader Search Request error: {:?}", e))?;
        match response.json::<Shader>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_shader_info(slug_or_id: &str) -> Result<ShaderInfo, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Shader Search Request error: {:?}", e))?;
        match response.json::<ShaderInfo>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn install_shader(slug: &str, params: &str) -> Result<Shader, Box<dyn Error>> {
        let shader_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = shader_versions.first().ok_or("Shader not found")?;
        let project = ModrinthApiEndpoints::get_shader_info(&slug).await?;

        Ok(Shader {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
    }
    
    // RESOURCE-PACKS
    pub async fn search_resourcepacks(params: &ModrinthSearchRequestParams) -> Result<ModrinthResourcePacksSearchResponse, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&index={}&limit={}&offset={}&query={}", params.facets, params.index, params.limit, params.offset, params.query);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModrinthResourcePacksSearchResponse>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_custom_resourcepack_names(resourcepacks_path: &Path, installed_resourcepacks: &Vec<ResourcePack>) -> anyhow::Result<Vec<String>> {
        tokio::fs::create_dir_all(&resourcepacks_path).await?;

        let mut resourcepacks_read = tokio::fs::read_dir(&resourcepacks_path).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = resourcepacks_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_resourcepacks.iter().any(|resourcepack| resourcepack.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn get_resourcepack_slug(slug_or_id: &str) -> Result<ResourcePack, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth ResourcePack Search Request error: {:?}", e))?;
        match response.json::<ResourcePack>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_resourcepack_info(slug_or_id: &str) -> Result<ResourcePackInfo, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth ResourcePack Search Request error: {:?}", e))?;
        match response.json::<ResourcePackInfo>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn install_resourcepack(slug: &str, params: &str) -> Result<ResourcePack, Box<dyn Error>> {
        let resourcepack_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = resourcepack_versions.first().ok_or("ResourcePack not found")?;
        let project = ModrinthApiEndpoints::get_resourcepack_info(&slug).await?;

        Ok(ResourcePack {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
    }
    
    // DATAPACKS
    pub async fn search_datapacks(params: &ModrinthSearchRequestParams) -> Result<ModrinthDatapacksSearchResponse, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&l=datapack&index={}&limit={}&offset={}&query={}", params.facets, params.index, params.limit, params.offset, params.query);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModrinthDatapacksSearchResponse>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_custom_datapack_names(datapacks_path: &Path, installed_resourcepacks: &Vec<Datapack>) -> anyhow::Result<Vec<String>> {
        tokio::fs::create_dir_all(&datapacks_path).await?;

        let mut datapacks_read = tokio::fs::read_dir(&datapacks_path).await?;
        let mut files: Vec<String> = Vec::new();
        while let Some(entry) = datapacks_read.next_entry().await? {
            if entry.file_type().await?.is_file() && entry.file_name().to_str().unwrap().ends_with(".zip") {
                if !installed_resourcepacks.iter().any(|datapack| datapack.file_name == entry.file_name().to_str().unwrap().to_string()) {
                    files.push(entry.file_name().to_str().unwrap().to_string());
                }
            }
        }

        Ok(files)
    }

    pub async fn get_datapack_slug(slug_or_id: &str) -> Result<ResourcePack, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Datapack Search Request error: {:?}", e))?;
        match response.json::<ResourcePack>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn get_datapack_info(slug_or_id: &str) -> Result<DatapackInfo, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/project/{}", slug_or_id);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Datapack Search Request error: {:?}", e))?;
        match response.json::<DatapackInfo>().await {
            Ok(json) => Ok(json),
            Err(e) => Err(Box::new(e) as Box<dyn Error>),
        }
    }

    pub async fn install_datapack(slug: &str, params: &str, world: &str) -> Result<Datapack, Box<dyn Error>> {
        let datapack_versions = ModrinthApiEndpoints::get_project_version(slug, params).await?;
        let project_version = datapack_versions.first().ok_or("Datapack not found")?;
        let project = ModrinthApiEndpoints::get_datapack_info(&slug).await?;

        Ok(Datapack {
            slug: project.slug,
            title: project.title,
            icon_url: project.icon_url,
            world_name: world.to_string(),
            file_name: project_version.files.first().unwrap().filename.clone(),
            url: Some(project_version.files.first().unwrap().url.clone())
        })
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
    pub icon_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ShaderInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: String,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Shader {
    pub slug: String,
    pub title: String,
    pub file_name: String,
    pub icon_url: String,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ResourcePackInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: String,
    pub downloads: u32,
    pub game_versions: Option<Vec<String>>,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourcePack {
    pub slug: String,
    pub title: String,
    pub file_name: String,
    pub icon_url: String,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DatapackInfo {
    pub slug: String,
    pub author: Option<String>,
    pub title: String,
    pub description: String,
    pub icon_url: String,
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
    pub icon_url: String,
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
    pub fn to_custom_mod(&self, title: &str, slug: &str, image_url: &str, dependencies: Vec<CustomMod>, required: bool, enabled: bool) -> CustomMod {
        let file_name = self.files.first().map(|file| {
            file.filename.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());
        let repo_artifact = format!("maven.modrinth:{}:{}", slug, self.version_number);
        let url = self.files.first().map(|file| {
            file.url.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());

        return CustomMod {
            title: title.to_string(),
            image_url: image_url.to_string(),
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
    pub image_url: String,
    pub value: LoaderMod,
    pub dependencies: Vec<CustomMod>,
}