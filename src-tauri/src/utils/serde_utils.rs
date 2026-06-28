use serde::{self, Deserialize, Deserializer};

/// Deserialize a u64 value that might come as a string or number
/// Useful for CurseForge API responses where numeric fields are sometimes strings
pub fn deserialize_optional_u64_from_string<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrU64 {
        String(String),
        U64(u64),
    }

    let value: Option<StringOrU64> = Option::deserialize(deserializer)?;
    match value {
        Some(StringOrU64::String(s)) => s
            .parse::<u64>()
            .map(Some)
            .map_err(serde::de::Error::custom),
        Some(StringOrU64::U64(n)) => Ok(Some(n)),
        None => Ok(None),
    }
}
