use crate::state::profile_state::Profile;
use serde::{Deserialize, Serialize};

/// Represents the overall structure of the standard profiles from the backend
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoriskVersionsConfig {
    /// A list of standard profiles
    pub profiles: Vec<Profile>,
}

impl Default for NoriskVersionsConfig {
    fn default() -> Self {
        Self { profiles: vec![] }
    }
}
