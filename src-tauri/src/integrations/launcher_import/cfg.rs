use crate::error::{AppError, Result};
use std::collections::HashMap;
use std::path::Path;

const MAX_CFG_BYTES: u64 = 1024 * 1024;
const MAX_CFG_KEYS: usize = 5000;

const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

pub fn decode_text(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.trim_start_matches('\u{FEFF}').to_string();
    }

    bytes
        .iter()
        .map(|byte| match byte {
            0x80..=0x9F => CP1252_HIGH[(byte - 0x80) as usize],
            other => *other as char,
        })
        .collect()
}

#[derive(Debug, Clone, Default)]
pub struct CfgFile(HashMap<String, String>);

impl CfgFile {
    pub fn parse(text: &str) -> Self {
        let mut values = HashMap::new();

        for line in text.lines() {
            if values.len() >= MAX_CFG_KEYS {
                break;
            }

            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                continue;
            }

            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            if key.is_empty() {
                continue;
            }

            values.insert(key.to_string(), value.trim().to_string());
        }

        Self(values)
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(|value| value.as_str())
    }

    pub fn get_non_empty(&self, key: &str) -> Option<&str> {
        self.get(key).map(str::trim).filter(|value| !value.is_empty())
    }

    pub fn get_bool(&self, key: &str) -> Option<bool> {
        match self.get(key)?.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        }
    }

    pub fn get_u32(&self, key: &str) -> Option<u32> {
        self.get(key)?.parse().ok()
    }

    pub fn get_i64(&self, key: &str) -> Option<i64> {
        self.get(key)?.parse().ok()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub async fn read_cfg(path: &Path) -> Result<CfgFile> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(CfgFile::default()),
        Err(e) => return Err(AppError::Io(e)),
    };

    if metadata.len() > MAX_CFG_BYTES {
        return Err(AppError::Other(format!(
            "Config file '{}' is too large to be a launcher config ({} bytes)",
            path.display(),
            metadata.len()
        )));
    }

    let bytes = tokio::fs::read(path).await.map_err(AppError::Io)?;
    Ok(CfgFile::parse(&decode_text(&bytes)))
}
