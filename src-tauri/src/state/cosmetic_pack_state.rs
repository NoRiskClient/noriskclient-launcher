use crate::error::Result;
use crate::minecraft::api::cosmetic_pack_api::{load_pack_index, ParsedPack};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct CosmeticPackManager {
    cache: RwLock<HashMap<String, Arc<ParsedPack>>>,
}

impl CosmeticPackManager {
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_or_load(&self, pack_id: &str) -> Result<Arc<ParsedPack>> {
        if let Some(pack) = self.cache.read().await.get(pack_id) {
            return Ok(pack.clone());
        }
        let parsed = Arc::new(load_pack_index(pack_id).await?);
        self.cache
            .write()
            .await
            .insert(pack_id.to_string(), parsed.clone());
        Ok(parsed)
    }

    #[allow(dead_code)]
    pub async fn invalidate(&self, pack_id: &str) {
        self.cache.write().await.remove(pack_id);
    }

    #[allow(dead_code)]
    pub async fn clear(&self) {
        self.cache.write().await.clear();
    }
}

impl Default for CosmeticPackManager {
    fn default() -> Self {
        Self::new()
    }
}
