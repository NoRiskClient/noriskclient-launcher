use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AddonsProgress {
    pub identifier: String,
    pub current: u64,
    pub max: u64
}