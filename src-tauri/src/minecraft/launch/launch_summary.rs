use log::info;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default, Debug)]
pub struct DownloadStats {
    cached: AtomicUsize,
    downloaded: AtomicUsize,
    failed: AtomicUsize,
    bytes: AtomicU64,
}

impl DownloadStats {
    pub fn record_cached(&self) {
        self.cached.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_downloaded(&self, bytes: u64) {
        self.downloaded.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    pub fn record_failed(&self) {
        self.failed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn cached(&self) -> usize {
        self.cached.load(Ordering::Relaxed)
    }

    pub fn downloaded(&self) -> usize {
        self.downloaded.load(Ordering::Relaxed)
    }

    pub fn failed(&self) -> usize {
        self.failed.load(Ordering::Relaxed)
    }

    pub fn bytes(&self) -> u64 {
        self.bytes.load(Ordering::Relaxed)
    }

    pub fn is_empty(&self) -> bool {
        self.cached() == 0 && self.downloaded() == 0 && self.failed() == 0
    }

    pub fn describe(&self) -> String {
        if self.is_empty() {
            return "none".to_string();
        }
        let mut parts = Vec::with_capacity(3);
        if self.cached() > 0 {
            parts.push(format!("{} cached", self.cached()));
        }
        if self.downloaded() > 0 {
            parts.push(format!(
                "{} new ({})",
                self.downloaded(),
                format_bytes(self.bytes())
            ));
        }
        if self.failed() > 0 {
            parts.push(format!("{} failed", self.failed()));
        }
        parts.join(", ")
    }
}

#[derive(Default, Debug)]
pub struct LaunchSummary {
    pub libraries: Arc<DownloadStats>,
    pub client: Arc<DownloadStats>,
    pub assets: Arc<DownloadStats>,
    pub nrc_assets: Arc<DownloadStats>,
    pub loader_libraries: Arc<DownloadStats>,
    pub mods: Arc<DownloadStats>,
    phases: Mutex<Vec<(String, u128)>>,
}

impl LaunchSummary {
    pub fn record_phase(&self, label: &str, elapsed_ms: u128) {
        if let Ok(mut phases) = self.phases.lock() {
            phases.push((label.to_string(), elapsed_ms));
        }
    }

    pub fn log(&self, profile_name: &str, mc_version: &str, loader: &str, total_ms: u128) {
        info!(
            "[Launch] {} {}/{} ready in {}",
            profile_name,
            mc_version,
            loader,
            format_duration(total_ms)
        );

        let sections: [(&str, &DownloadStats); 6] = [
            ("libraries", &self.libraries),
            ("client", &self.client),
            ("assets", &self.assets),
            ("nrc assets", &self.nrc_assets),
            ("loader libs", &self.loader_libraries),
            ("mods", &self.mods),
        ];
        let downloads: Vec<String> = sections
            .iter()
            .filter(|(_, stats)| !stats.is_empty())
            .map(|(name, stats)| format!("{} {}", name, stats.describe()))
            .collect();
        let failed: usize = sections.iter().map(|(_, stats)| stats.failed()).sum();
        info!(
            "[Launch] downloads: {} | failed {}",
            if downloads.is_empty() {
                "none".to_string()
            } else {
                downloads.join(" | ")
            },
            failed
        );

        if let Ok(phases) = self.phases.lock() {
            if !phases.is_empty() {
                let rendered: Vec<String> = phases
                    .iter()
                    .map(|(label, ms)| format!("{} {}", label, format_duration(*ms)))
                    .collect();
                info!("[Launch] phases: {}", rendered.join(", "));
            }
        }
    }
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn format_duration(ms: u128) -> String {
    if ms >= 1000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else {
        format!("{}ms", ms)
    }
}
