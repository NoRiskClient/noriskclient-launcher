use std::fmt::Display;

use serde::{Deserialize, Serialize};

use crate::minecraft::progress::ProgressUpdate;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomServer {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    pub owner: String,
    #[serde(rename = "mcVersion")]
    pub mc_version: String,
    #[serde(rename = "loaderVersion")]
    pub loader_version: Option<String>,
    pub r#type: CustomServerType,
    pub domain: String,
    pub subdomain: String,
    #[serde(rename = "lastOnline")]
    pub last_online: u64,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub enum CustomServerType {
    VANILLA,
    FORGE,
    FABRIC,
    #[allow(non_camel_case_types)] // TODO: do we really need this?
    NEO_FORGE,
    QUILT,
    PAPER,
    SPIGOT,
    BUKKIT,
    FOLIA,
    PURPUR,
}

impl CustomServerType {
    pub fn from_string(s: &str) -> Self {
        match s {
            "VANILLA" => CustomServerType::VANILLA,
            "FORGE" => CustomServerType::FORGE,
            "FABRIC" => CustomServerType::FABRIC,
            "NEO_FORGE" => CustomServerType::NEO_FORGE,
            "QUILT" => CustomServerType::QUILT,
            "PAPER" => CustomServerType::PAPER,
            "SPIGOT" => CustomServerType::SPIGOT,
            "BUKKIT" => CustomServerType::BUKKIT,
            "FOLIA" => CustomServerType::FOLIA,
            "PURPUR" => CustomServerType::PURPUR,
            _ => CustomServerType::VANILLA,
        }
    }
}

impl Display for CustomServerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CustomServerType::VANILLA => write!(f, "VANILLA"),
            CustomServerType::FORGE => write!(f, "FORGE"),
            CustomServerType::FABRIC => write!(f, "FABRIC"),
            CustomServerType::NEO_FORGE => write!(f, "NEO_FORGE"),
            CustomServerType::QUILT => write!(f, "QUILT"),
            CustomServerType::PAPER => write!(f, "PAPER"),
            CustomServerType::SPIGOT => write!(f, "SPIGOT"),
            CustomServerType::BUKKIT => write!(f, "BUKKIT"),
            CustomServerType::FOLIA => write!(f, "FOLIA"),
            CustomServerType::PURPUR => write!(f, "PURPUR"),
        }
    }
}

impl Serialize for CustomServerType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let s = self.to_string();
        serializer.serialize_str(&s)
    }
}

impl<'de> Deserialize<'de> for CustomServerType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(CustomServerType::from_string(&s))
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct CustomServerEventPayload {
    pub server_id: String,
    pub data: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct CustomServerProgressEventPayload {
    pub server_id: String,
    pub data: ProgressUpdate,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct LatestRunningServer {
    #[serde(rename = "forwarderProcessId")]
    pub forwarder_process_id: Option<u32>,
    #[serde(rename = "processId")]
    pub process_id: Option<u32>,
    #[serde(rename = "serverId")]
    pub server_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomServerTokenResponse {
    pub jwt: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
}
