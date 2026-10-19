use crate::support::files::{read_head_lossy, resolve_safe_file};
use crate::support::handler::SupportContext;
use crate::support::handlers::logs::{found, FileItemHandler, Located};
use crate::utils::security_utils::mask_sensitive_data;
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const MAX_INDEX_BYTES: u64 = 64 * 1024;
const MAX_PROFILE_BYTES: u64 = 512 * 1024;
const MAX_DEPTH: usize = 32;
const MAX_STRING_CHARS: usize = 4096;
const FILE_ENDINGS: &[&str] = &[
    "json", "txt", "png", "jpg", "jpeg", "gif", "ogg", "wav", "log", "yml", "yaml", "toml", "cfg",
    "properties", "jar", "zip", "mcmeta", "nbt", "dat", "gz", "js", "html", "css",
];

static HOST: Lazy<Regex> = Lazy::new(|| {
    RegexBuilder::new(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?$")
        .case_insensitive(true)
        .build()
        .unwrap()
});

pub const HANDLER: FileItemHandler = FileItemHandler {
    redact: anonymize,
    ..FileItemHandler::plain("NRC_PROFILE", locate_nrc_profile)
};

#[derive(Deserialize)]
struct ProfileIndex {
    current: String,
}

#[derive(Deserialize)]
struct ServerOrder {
    #[serde(default, deserialize_with = "keys_in_order")]
    servers: Vec<String>,
}

fn keys_in_order<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    struct Keys;
    impl<'de> Visitor<'de> for Keys {
        type Value = Vec<String>;

        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("an object")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Vec<String>, A::Error> {
            let mut keys = Vec::new();
            while let Some((key, IgnoredAny)) = map.next_entry::<String, IgnoredAny>()? {
                keys.push(key);
            }
            Ok(keys)
        }
    }
    deserializer.deserialize_map(Keys)
}

#[derive(Default)]
struct Aliases {
    hosts: Vec<String>,
    known: Option<Regex>,
}

impl Aliases {
    fn of(&mut self, host: &str) -> String {
        let key = host.to_lowercase();
        let index = self.hosts.iter().position(|h| *h == key).unwrap_or_else(|| {
            self.hosts.push(key);
            self.known = None;
            self.hosts.len() - 1
        });
        format!("server-{}", index + 1)
    }

    fn is_host(&self, text: &str) -> bool {
        let key = text.to_lowercase();
        if self.hosts.contains(&key) {
            return true;
        }
        let ending = key
            .split(':')
            .next()
            .and_then(|h| h.rsplit('.').next())
            .unwrap_or_default();
        (4..=253).contains(&text.len()) && HOST.is_match(text) && !FILE_ENDINGS.contains(&ending)
    }

    fn replace_known(&mut self, text: &str) -> String {
        if self.hosts.is_empty() {
            return text.to_string();
        }
        if self.known.is_none() {
            let mut longest_first: Vec<&String> = self.hosts.iter().collect();
            longest_first.sort_by_key(|h| std::cmp::Reverse(h.len()));
            let pattern = longest_first
                .iter()
                .map(|h| regex::escape(h))
                .collect::<Vec<_>>()
                .join("|");
            self.known = RegexBuilder::new(&pattern).case_insensitive(true).build().ok();
        }
        let hosts = &self.hosts;
        match &self.known {
            Some(known) => known
                .replace_all(text, |found: &regex::Captures| {
                    let key = found[0].to_lowercase();
                    let index = hosts.iter().position(|h| *h == key).unwrap_or_default();
                    format!("server-{}", index + 1)
                })
                .into_owned(),
            None => text.to_string(),
        }
    }

    fn text(&mut self, raw: &str) -> String {
        let anonymized = if self.is_host(raw) {
            self.of(raw)
        } else {
            self.replace_known(raw)
        };
        mask_sensitive_data(&anonymized)
            .chars()
            .take(MAX_STRING_CHARS)
            .collect()
    }

    fn walk(&mut self, value: Value, depth: usize) -> Result<Value, String> {
        if depth > MAX_DEPTH {
            return Err("invalid json: nested too deep".into());
        }
        Ok(match value {
            Value::Object(map) => {
                let mut out = Map::new();
                for (key, child) in map {
                    out.insert(self.text(&key), self.walk(child, depth + 1)?);
                }
                Value::Object(out)
            }
            Value::Array(items) => Value::Array(
                items
                    .into_iter()
                    .map(|v| self.walk(v, depth + 1))
                    .collect::<Result<_, _>>()?,
            ),
            Value::String(s) => Value::String(self.text(&s)),
            other => other,
        })
    }
}

fn anonymize(text: &str) -> Result<String, String> {
    let root: Map<String, Value> =
        serde_json::from_str(text).map_err(|e| format!("invalid json: {}", e))?;
    let mut aliases = Aliases::default();
    let order = serde_json::from_str::<ServerOrder>(text).map_or_else(|_| Vec::new(), |o| o.servers);
    for host in order {
        aliases.of(&host);
    }
    let walked = aliases.walk(Value::Object(root), 0)?;
    serde_json::to_string_pretty(&walked)
        .map(|s| s + "\n")
        .map_err(|e| format!("internal error: {}", e))
}

fn locate(instance: &Path) -> Result<Located, String> {
    let root = instance.join("NoRiskClient");
    let missing = || Located::Missing("no NoRisk profile found".into());
    let Some(index) = resolve_safe_file(&root, Path::new("profiles.json"))? else {
        return Ok(missing());
    };
    let index: ProfileIndex = read_head_lossy(&index, MAX_INDEX_BYTES)
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or("invalid json: profiles.json")?;
    let relative = PathBuf::from("profiles").join(format!("{}.json", index.current));
    let Some(path) = resolve_safe_file(&root, &relative)? else {
        return Ok(missing());
    };
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("cannot read file: {}", e))?
        .len();
    if size > MAX_PROFILE_BYTES {
        return Err(format!("too_large: {} bytes", size));
    }
    Ok(found(&root, relative))
}

fn locate_nrc_profile(ctx: &SupportContext) -> Located {
    locate(&ctx.instance_path).unwrap_or_else(Located::Rejected)
}
