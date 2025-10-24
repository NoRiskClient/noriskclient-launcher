use super::event::AnalyticsEvent;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEventBatch {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub events: Vec<AnalyticsEvent>,
}

pub struct AnalyticsStorage {
    storage_dir: PathBuf,
}

impl AnalyticsStorage {
    pub fn new(storage_dir: PathBuf) -> Self {
        Self { storage_dir }
    }

    pub async fn init(&self) -> Result<(), String> {
        if let Err(e) = fs::create_dir_all(&self.storage_dir).await {
            return Err(format!("Failed to create storage directory: {}", e));
        }
        info!("Analytics storage initialized at: {:?}", self.storage_dir);
        Ok(())
    }

    pub async fn store_events(&self, events: Vec<AnalyticsEvent>) -> Result<(), String> {
        if events.is_empty() {
            return Ok(());
        }

        let batch = StoredEventBatch {
            timestamp: chrono::Utc::now(),
            events: events.clone(),
        };

        // Create filename with timestamp
        let filename = format!(
            "events_{}.json",
            batch.timestamp.format("%Y%m%d_%H%M%S_%3f")
        );
        let file_path = self.storage_dir.join(filename);

        // Serialize to JSON
        let json = serde_json::to_string_pretty(&batch)
            .map_err(|e| format!("Failed to serialize events: {}", e))?;

        // Write to file
        let mut file = fs::File::create(&file_path)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;

        file.write_all(json.as_bytes())
            .await
            .map_err(|e| format!("Failed to write events: {}", e))?;

        info!(
            "Stored {} events to: {:?}",
            events.len(),
            file_path
        );

        Ok(())
    }

    pub async fn get_all_events(&self) -> Result<Vec<AnalyticsEvent>, String> {
        let mut all_events = Vec::new();

        let mut entries = fs::read_dir(&self.storage_dir)
            .await
            .map_err(|e| format!("Failed to read storage directory: {}", e))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match self.read_event_file(&path).await {
                    Ok(batch) => all_events.extend(batch.events),
                    Err(e) => warn!("Failed to read event file {:?}: {}", path, e),
                }
            }
        }

        debug!("Loaded total of {} events from storage", all_events.len());
        Ok(all_events)
    }

    async fn read_event_file(&self, path: &Path) -> Result<StoredEventBatch, String> {
        let contents = fs::read_to_string(path)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        let batch: StoredEventBatch = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        Ok(batch)
    }

    pub async fn get_event_count(&self) -> Result<usize, String> {
        let events = self.get_all_events().await?;
        Ok(events.len())
    }

    pub async fn get_stats(&self) -> Result<AnalyticsStats, String> {
        let events = self.get_all_events().await?;

        let mut stats = AnalyticsStats::default();
        stats.total_events = events.len();

        // Count by event name
        for event in &events {
            *stats.events_by_name.entry(event.name.clone()).or_insert(0) += 1;
        }

        // Count profile launches by game version
        for event in &events {
            if event.name == "profile_launched" {
                if let Some(version) = event.properties.get("game_version") {
                    if let Some(version_str) = version.as_str() {
                        *stats
                            .launches_by_version
                            .entry(version_str.to_string())
                            .or_insert(0) += 1;
                    }
                }

                if let Some(loader) = event.properties.get("loader") {
                    if let Some(loader_str) = loader.as_str() {
                        *stats
                            .launches_by_loader
                            .entry(loader_str.to_string())
                            .or_insert(0) += 1;
                    }
                }
            }
        }

        Ok(stats)
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AnalyticsStats {
    pub total_events: usize,
    pub events_by_name: std::collections::HashMap<String, usize>,
    pub launches_by_version: std::collections::HashMap<String, usize>,
    pub launches_by_loader: std::collections::HashMap<String, usize>,
}

