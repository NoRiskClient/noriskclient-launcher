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
    #[must_use]
    pub fn from_string(s: &str) -> Self {
        match s {
            "FORGE" => Self::FORGE,
            "FABRIC" => Self::FABRIC,
            "NEO_FORGE" => Self::NEO_FORGE,
            "QUILT" => Self::QUILT,
            "PAPER" => Self::PAPER,
            "SPIGOT" => Self::SPIGOT,
            "BUKKIT" => Self::BUKKIT,
            "FOLIA" => Self::FOLIA,
            "PURPUR" => Self::PURPUR,
            _ => Self::VANILLA,
        }
    }
}

impl Display for CustomServerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::VANILLA => write!(f, "VANILLA"),
            Self::FORGE => write!(f, "FORGE"),
            Self::FABRIC => write!(f, "FABRIC"),
            Self::NEO_FORGE => write!(f, "NEO_FORGE"),
            Self::QUILT => write!(f, "QUILT"),
            Self::PAPER => write!(f, "PAPER"),
            Self::SPIGOT => write!(f, "SPIGOT"),
            Self::BUKKIT => write!(f, "BUKKIT"),
            Self::FOLIA => write!(f, "FOLIA"),
            Self::PURPUR => write!(f, "PURPUR"),
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
        Ok(Self::from_string(&s))
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
