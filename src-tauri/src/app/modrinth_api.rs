use std::error::Error;
use serde::{Deserialize, Serialize};
use crate::HTTP_CLIENT;
use std::fs;
#[cfg(target_os = "linux")]
use std::{fs::metadata};
use std::path::Path;
use crate::app::api::{LoaderMod, ModSource};

/// Placeholder struct for API endpoints implementation
pub struct ModrinthApiEndpoints;

impl ModrinthApiEndpoints {
    pub async fn search_mods(params: &ModrinthSearchRequestParams) -> Result<ModrinthSearchResponse, Box<dyn Error>> {
        let url = format!("https://api.modrinth.com/v2/search?facets={}&limit={}&query={}", params.facets, params.limit, params.query);
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(|e| format!("Modrinth Search Request error: {:?}", e))?;
        match response.json::<ModrinthSearchResponse>().await {
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

    pub async fn get_mod_version(slug: &str, params: &str) -> Result<Vec<ModrinthProject>, Box<dyn Error>> {
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
                let dependency_mods = ModrinthApiEndpoints::get_mod_version(&dependency.project_id, params).await?;
                if let Some(dependency_mod) = dependency_mods.first() {
                    let slug_holder = ModrinthApiEndpoints::get_mod_slug(&dependency.project_id).await?;
                    let required = dependency_mod.is_already_required_by_norisk_client(required_mods);
                    if required {
                        result.push(dependency_mod.to_custom_mod(&slug_holder.slug, &slug_holder.icon_url, Vec::new(), false, false));
                    } else {
                        result.push(dependency_mod.to_custom_mod(&slug_holder.slug, &slug_holder.icon_url, Vec::new(), false, true));
                    };
                }
            }
        }

        Ok(result)
    }

    pub async fn install_mod_and_dependencies(slug: &str, params: &str, required_mods: &Vec<LoaderMod>) -> Result<CustomMod, Box<dyn Error>> {
        let mod_versions = ModrinthApiEndpoints::get_mod_version(slug, params).await?;
        let project = mod_versions.first().ok_or("Mod not found")?;

        let dependencies = ModrinthApiEndpoints::get_dependencies(&project.dependencies, params, required_mods).await?;

        Ok(CustomMod {
            value: project.to_loader_mod(slug, false, true),
            image_url: "".to_string(), //Ich setze das einfach in Tauri kein bock
            dependencies,
        })
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthSearchResponse {
    hits: Vec<ModInfo>,
    offset: u32,
    limit: u32,
    total_hits: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModrinthSearchRequestParams {
    pub facets: String,
    pub limit: u32,
    pub query: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ModInfo {
    pub slug: String,
    pub author: String,
    pub title: String,
    pub description: String,
    pub icon_url: String,
}

//Minified response from https://api.modrinth.com/v2/project/{id|slug}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Mod {
    pub slug: String,
    pub title: String,
    pub icon_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthProject {
    pub id: String,
    pub project_id: String,
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
    pub fn to_custom_mod(&self, slug: &str, image_url: &str, dependencies: Vec<CustomMod>, required: bool, enabled: bool) -> CustomMod {
        let file_name = self.files.first().map(|file| {
            file.filename.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());
        let repo_artifact = format!("maven.modrinth:{}:{}", slug, self.version_number);
        let url = self.files.first().map(|file| {
            file.url.clone()
        }).unwrap_or("MOD_FALL_BACK".to_string());
        return CustomMod {
            value: LoaderMod {
                enabled,
                required,
                name: file_name,
                source: ModSource::Repository {
                    repository: "modrinth".to_string(),
                    artifact: repo_artifact,
                    url
                },
            },
            image_url: image_url.to_string(),
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
                url
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
pub struct InstalledMods {
    pub mods: Vec<CustomMod>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomMod {
    pub value: LoaderMod,
    pub image_url: String,
    pub dependencies: Vec<CustomMod>,
}

impl InstalledMods {
    pub async fn load(app_data: &Path) -> anyhow::Result<Self> {
        // load the options from the file
        Ok(serde_json::from_slice::<Self>(&tokio::fs::read(app_data.join("installed_mods.json")).await?)?)
    }

    pub async fn store(&self, app_data: &Path) -> anyhow::Result<()> {
        // store the options in the file
        tokio::fs::write(app_data.join("installed_mods.json"), serde_json::to_string_pretty(&self)?).await?;
        Ok(())
    }
}

impl Default for InstalledMods {
    fn default() -> Self {
        Self {
            mods: Vec::new(),
        }
    }
}