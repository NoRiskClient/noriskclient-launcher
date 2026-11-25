use fastnbt::Value;
use std::collections::HashMap;

const SERVERS_KEY: &str = "servers";

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerListEdit {
    Add { name: String, address: String },
    Update { index: usize, expected_address: String, name: String, address: String },
    Remove { index: usize, expected_address: String },
    RemoveMany { entries: Vec<ServerRef> },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRef {
    pub index: usize,
    pub expected_address: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ServerListError {
    #[error("servers.dat could not be read")]
    Unreadable,
    #[error("the server list changed in the meantime")]
    Stale,
    #[error("a server needs an address")]
    Invalid,
}

pub fn apply_server_list_edit(current: Option<&[u8]>, edit: &ServerListEdit) -> Result<Vec<u8>, ServerListError> {
    let mut root = match current {
        Some(bytes) => match fastnbt::from_bytes::<Value>(bytes) {
            Ok(Value::Compound(root)) => root,
            _ => return Err(ServerListError::Unreadable),
        },
        None => HashMap::new(),
    };
    let mut entries = match root.remove(SERVERS_KEY) {
        Some(Value::List(entries)) => entries,
        None => Vec::new(),
        Some(_) => return Err(ServerListError::Unreadable),
    };

    match edit {
        ServerListEdit::Add { name, address } => {
            let (name, address) = clean(name, address)?;
            let mut entry = HashMap::new();
            entry.insert("name".to_string(), Value::String(name));
            entry.insert("ip".to_string(), Value::String(address));
            entries.push(Value::Compound(entry));
        }
        ServerListEdit::Update { index, expected_address, name, address } => {
            let (name, address) = clean(name, address)?;
            let entry = matching(&mut entries, *index, expected_address)?;
            if address != *expected_address {
                entry.remove("icon");
            }
            entry.insert("name".to_string(), Value::String(name));
            entry.insert("ip".to_string(), Value::String(address));
        }
        ServerListEdit::Remove { index, expected_address } => {
            matching(&mut entries, *index, expected_address)?;
            entries.remove(*index);
        }
        ServerListEdit::RemoveMany { entries: targets } => {
            let mut indexes: Vec<usize> = targets.iter().map(|target| target.index).collect();
            indexes.sort_unstable();
            indexes.dedup();
            if indexes.len() != targets.len() {
                return Err(ServerListError::Stale);
            }
            for target in targets {
                matching(&mut entries, target.index, &target.expected_address)?;
            }
            for index in indexes.into_iter().rev() {
                entries.remove(index);
            }
        }
    }

    root.insert(SERVERS_KEY.to_string(), Value::List(entries));
    fastnbt::to_bytes(&Value::Compound(root)).map_err(|_| ServerListError::Unreadable)
}

fn clean(name: &str, address: &str) -> Result<(String, String), ServerListError> {
    let address = address.trim();
    if address.is_empty() {
        return Err(ServerListError::Invalid);
    }
    let name = name.trim();
    let name = if name.is_empty() { address } else { name };
    Ok((name.to_string(), address.to_string()))
}

fn matching<'a>(
    entries: &'a mut [Value],
    index: usize,
    expected_address: &str,
) -> Result<&'a mut HashMap<String, Value>, ServerListError> {
    match entries.get_mut(index) {
        Some(Value::Compound(entry))
            if matches!(entry.get("ip"), Some(Value::String(ip)) if ip == expected_address) =>
        {
            Ok(entry)
        }
        _ => Err(ServerListError::Stale),
    }
}
