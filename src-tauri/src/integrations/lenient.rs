use log::warn;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use std::collections::HashMap;

fn type_name<T>() -> &'static str {
    let full = std::any::type_name::<T>();
    full.rsplit("::").next().unwrap_or(full)
}

fn identify(value: &Value) -> String {
    value
        .get("id")
        .or_else(|| value.get("slug"))
        .or_else(|| value.get("name"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "<unidentified>".to_string())
}

pub fn collect<T: DeserializeOwned>(values: Vec<Value>) -> Vec<T> {
    let mut parsed = Vec::with_capacity(values.len());
    for value in values {
        let id = identify(&value);
        match serde_json::from_value::<T>(value) {
            Ok(item) => parsed.push(item),
            Err(e) => warn!("Skipping unparseable {} {}: {}", type_name::<T>(), id, e),
        }
    }
    parsed
}

pub fn vec<'de, D, T>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(Option::<Vec<Value>>::deserialize(deserializer)?
        .map(collect)
        .unwrap_or_default())
}

pub fn opt_vec<'de, D, T>(deserializer: D) -> std::result::Result<Option<Vec<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    Ok(Option::<Vec<Value>>::deserialize(deserializer)?.map(collect))
}

pub fn opt<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let Some(value) = Option::<Value>::deserialize(deserializer)? else {
        return Ok(None);
    };

    let id = identify(&value);
    match serde_json::from_value::<T>(value) {
        Ok(item) => Ok(Some(item)),
        Err(e) => {
            warn!("Dropping unparseable {} {}: {}", type_name::<T>(), id, e);
            Ok(None)
        }
    }
}

pub fn list_from_str<T: DeserializeOwned>(text: &str) -> serde_json::Result<Vec<T>> {
    Ok(collect(serde_json::from_str::<Vec<Value>>(text)?))
}

pub fn map_from_str<T: DeserializeOwned>(text: &str) -> serde_json::Result<HashMap<String, T>> {
    let raw: HashMap<String, Value> = serde_json::from_str(text)?;
    let mut parsed = HashMap::with_capacity(raw.len());
    for (key, value) in raw {
        match serde_json::from_value::<T>(value) {
            Ok(item) => {
                parsed.insert(key, item);
            }
            Err(e) => warn!(
                "Skipping unparseable {} for key {}: {}",
                type_name::<T>(),
                key,
                e
            ),
        }
    }
    Ok(parsed)
}
