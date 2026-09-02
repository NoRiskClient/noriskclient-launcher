use serde::{Deserialize, Serialize};

/// Represents a Minecraft player profile as returned by Mojang's session server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfile {
    /// Player UUID (without hyphens)
    pub id: String,
    /// Player username
    pub name: String,
    /// Properties of the profile, including skin and cape data
    pub properties: Vec<ProfileProperty>,
}

/// A property of a Minecraft profile, typically containing textures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileProperty {
    /// The name of the property (typically "textures")
    pub name: String,
    /// Base64-encoded value of the property
    pub value: String,
    /// Optional signature
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// Decoded textures data for a Minecraft profile
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TexturesData {
    /// Unix timestamp in milliseconds
    pub timestamp: i64,
    /// Profile's UUID
    pub profile_id: String,
    /// Profile's name
    pub profile_name: String,
    /// Textures dictionary containing skin and cape information
    pub textures: TexturesDictionary,
}

/// Dictionary of textures for a Minecraft profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TexturesDictionary {
    /// Skin information
    #[serde(rename = "SKIN", skip_serializing_if = "Option::is_none")]
    pub skin: Option<TextureInfo>,
    /// Cape information
    #[serde(rename = "CAPE", skip_serializing_if = "Option::is_none")]
    pub cape: Option<TextureInfo>,
}

/// Information about a texture (skin or cape)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextureInfo {
    /// URL to the texture image
    pub url: String,
    /// Optional metadata for the texture (used for slim skin model)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<TextureMetadata>,
}

/// Metadata for a texture
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextureMetadata {
    /// Skin model type ("slim" or "default")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}
