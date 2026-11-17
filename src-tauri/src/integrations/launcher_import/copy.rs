use super::buckets::{self, Bucket};
use super::control;
use super::model::{ContentBucket, ImportSelection};
use crate::error::{AppError, Result};
use crate::utils::import_safety::safe_file_component;
use crate::state::event_state::ProgressThrottle;
use futures::stream::{self, StreamExt};
use log::warn;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

const MAX_FILES: usize = 200_000;
const MAX_BYTES: u64 = 40 * 1024 * 1024 * 1024;
const MAX_DEPTH: usize = 32;
const COPY_CONCURRENCY: usize = 8;
const PROGRESS_INTERVAL_MS: u64 = 150;

pub const DENY_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "bat", "cmd", "ps1", "vbs", "msi", "scr", "sh", "com", "wsf",
];

#[derive(Debug, Clone)]
pub struct PlannedFile {
    pub source: PathBuf,
    pub relative: PathBuf,
    pub bytes: u64,
}

#[derive(Debug, Default)]
pub struct CopyPlan {
    pub files: Vec<PlannedFile>,
    pub total_bytes: u64,
    pub per_bucket: Vec<ContentBucket>,
    pub executable_paths: Vec<String>,
    pub skipped_symlinks: Vec<String>,
    pub warnings: Vec<String>,
    pub truncated: bool,
}

impl CopyPlan {
    pub fn bucket_bytes(&self, key: &str) -> u64 {
        self.per_bucket
            .iter()
            .find(|bucket| bucket.key == key)
            .map(|bucket| bucket.bytes)
            .unwrap_or(0)
    }

    pub fn total_instance_bytes(&self) -> u64 {
        self.per_bucket.iter().map(|bucket| bucket.bytes).sum()
    }
}

#[derive(Default)]
struct Collected {
    files: Vec<PlannedFile>,
    bytes: u64,
    file_count: usize,
}

fn is_denied_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| DENY_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

struct Walker<'a> {
    plan: &'a mut CopyPlan,
    allow_executables: bool,
    collected: Collected,
}

impl<'a> Walker<'a> {
    fn new(plan: &'a mut CopyPlan, allow_executables: bool) -> Self {
        Self {
            plan,
            allow_executables,
            collected: Collected::default(),
        }
    }

    fn over_limit(&self, extra_bytes: u64) -> bool {
        self.plan.files.len() + self.collected.file_count >= MAX_FILES
            || self.plan.total_bytes + self.collected.bytes + extra_bytes > MAX_BYTES
    }

    fn push_file(&mut self, source: PathBuf, relative: PathBuf, bytes: u64) {
        if self.over_limit(bytes) {
            self.plan.truncated = true;
            return;
        }

        self.collected.bytes += bytes;
        self.collected.file_count += 1;
        self.collected.files.push(PlannedFile {
            source,
            relative,
            bytes,
        });
    }

    fn accepts_file(&mut self, relative: &Path, name: &str) -> bool {
        if !is_denied_extension(name) {
            return true;
        }

        self.plan
            .executable_paths
            .push(relative.display().to_string());
        self.allow_executables
    }

    async fn walk_dir(&mut self, source_root: &Path, relative_root: &Path) {
        let mut stack = vec![(source_root.to_path_buf(), relative_root.to_path_buf(), 0usize)];

        while let Some((dir, relative, depth)) = stack.pop() {
            if depth > MAX_DEPTH {
                self.plan
                    .warnings
                    .push(format!("too_deep:{}", relative.display()));
                continue;
            }

            let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
                continue;
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string)
                else {
                    self.plan
                        .warnings
                        .push(format!("unreadable_name:{}", relative.display()));
                    continue;
                };

                if safe_file_component(&name).is_err() {
                    self.plan.warnings.push(format!("unsafe_name:{}", name));
                    continue;
                }

                let Ok(metadata) = tokio::fs::symlink_metadata(&path).await else {
                    continue;
                };

                let child_relative = relative.join(&name);

                if metadata.file_type().is_symlink() {
                    self.plan
                        .skipped_symlinks
                        .push(child_relative.display().to_string());
                    continue;
                }

                if metadata.is_dir() {
                    stack.push((path, child_relative, depth + 1));
                } else if self.accepts_file(&child_relative, &name) {
                    self.push_file(path, child_relative, metadata.len());
                }
            }
        }
    }

    async fn walk_entry(&mut self, game_dir: &Path, entry_name: &str) {
        let source = game_dir.join(entry_name);
        let Ok(metadata) = tokio::fs::symlink_metadata(&source).await else {
            return;
        };

        if metadata.file_type().is_symlink() {
            self.plan.skipped_symlinks.push(entry_name.to_string());
            return;
        }

        if metadata.is_dir() {
            self.walk_dir(&source, Path::new(entry_name)).await;
            return;
        }

        let relative = PathBuf::from(entry_name);
        if self.accepts_file(&relative, entry_name) {
            self.push_file(source, relative, metadata.len());
        }
    }

    fn take(self) -> Collected {
        self.collected
    }
}

async fn count_directories(dir: &Path) -> usize {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };

    let mut count = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            count += 1;
        }
    }
    count
}

async fn entry_count_for(bucket: &Bucket, game_dir: &Path, files: usize) -> usize {
    if !bucket.counts_directories {
        return files;
    }

    let mut count = 0;
    for entry in bucket.entries {
        count += count_directories(&game_dir.join(entry)).await;
    }
    count
}

pub async fn build_plan(
    game_dir: &Path,
    selection: &ImportSelection,
    default_selection: &ImportSelection,
) -> CopyPlan {
    let mut plan = CopyPlan::default();

    for bucket in buckets::BUCKETS {
        let mut walker = Walker::new(&mut plan, selection.allow_executable_content);
        for entry in bucket.entries {
            walker.walk_entry(game_dir, entry).await;
        }
        let collected = walker.take();

        plan.per_bucket.push(ContentBucket {
            key: bucket.key.to_string(),
            entry_count: entry_count_for(bucket, game_dir, collected.file_count).await,
            bytes: collected.bytes,
            default_selected: default_selection.includes(bucket.key),
        });

        if bucket.key != buckets::MODS && selection.includes(bucket.key) {
            plan.total_bytes += collected.bytes;
            plan.files.extend(collected.files);
        }
    }

    plan.executable_paths.sort();
    plan.executable_paths.dedup();
    plan.skipped_symlinks.sort();

    plan
}

fn long_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.display().to_string();
        if text.len() > 240 && !text.starts_with("\\\\?\\") {
            return PathBuf::from(format!("\\\\?\\{}", text));
        }
    }
    path.to_path_buf()
}

async fn create_parents(plan: &CopyPlan, staging: &Path) -> Result<()> {
    let mut parents: HashSet<PathBuf> = HashSet::new();
    for file in &plan.files {
        if let Some(parent) = file.relative.parent() {
            parents.insert(staging.join(parent));
        }
    }

    for parent in parents {
        tokio::fs::create_dir_all(&parent)
            .await
            .map_err(AppError::Io)?;
    }

    Ok(())
}

pub async fn copy_planned<F, Fut>(
    plan: &CopyPlan,
    staging: &Path,
    cancel: &AtomicBool,
    on_progress: F,
) -> Result<u64>
where
    F: Fn(u64, u64) -> Fut + Sync,
    Fut: std::future::Future<Output = ()>,
{
    create_parents(plan, staging).await?;

    let copied = Arc::new(AtomicU64::new(0));
    let throttle = ProgressThrottle::new(PROGRESS_INTERVAL_MS);
    let on_progress = &on_progress;
    let total = plan.total_bytes;

    stream::iter(&plan.files)
        .for_each_concurrent(COPY_CONCURRENCY, |file| {
            let copied = copied.clone();
            let throttle = &throttle;
            async move {
                if control::is_cancelled(cancel) {
                    return;
                }

                let target = long_path(&staging.join(&file.relative));
                match tokio::fs::copy(&file.source, &target).await {
                    Ok(_) => {
                        let done = copied.fetch_add(file.bytes, Ordering::Relaxed) + file.bytes;
                        if throttle.should_emit() {
                            on_progress(done, total).await;
                        }
                    }
                    Err(e) => warn!("Skipping '{}' during import: {}", file.relative.display(), e),
                }
            }
        })
        .await;

    if control::is_cancelled(cancel) {
        return Err(AppError::Other("Import cancelled".to_string()));
    }

    let done = copied.load(Ordering::Relaxed);
    on_progress(done, total).await;
    Ok(done)
}
