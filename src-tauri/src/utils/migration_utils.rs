use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::state::profile_state::{
    Profile, LEGACY_DEFAULT_MEMORY_MAX_MB, LEGACY_DEFAULT_MEMORY_MIN_MB,
};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Eq)]
enum RunMode {
    Always,
    Once,
}

struct Migration {
    id: &'static str,
    mode: RunMode,
    run: fn(&mut HashMap<Uuid, Profile>) -> usize,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        id: "norisk_dev_to_prod",
        mode: RunMode::Always,
        run: move_norisk_dev_to_prod,
    },
    Migration {
        id: "memory_default_2gb",
        mode: RunMode::Once,
        run: raise_legacy_memory_default,
    },
];

pub fn migrate_profiles(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    migrate_profiles_with_ledger(profiles, &ledger_path())
}

fn migrate_profiles_with_ledger(profiles: &mut HashMap<Uuid, Profile>, path: &Path) -> usize {
    let mut ledger = read_ledger(path);
    let mut newly_applied: Vec<&str> = Vec::new();
    let mut migration_count = 0;

    for migration in MIGRATIONS {
        if migration.mode == RunMode::Once && ledger.applied.iter().any(|id| id == migration.id) {
            continue;
        }

        migration_count += (migration.run)(profiles);

        if migration.mode == RunMode::Once {
            newly_applied.push(migration.id);
        }
    }

    if !newly_applied.is_empty() {
        ledger
            .applied
            .extend(newly_applied.iter().map(|id| id.to_string()));
        write_ledger(path, &ledger);
    }

    if migration_count > 0 {
        info!(
            "ProfileManager: Completed profile migrations. Total changes: {}",
            migration_count
        );
    }

    migration_count
}

fn move_norisk_dev_to_prod(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let mut migrated_count = 0;

    for (_, profile) in profiles.iter_mut() {
        if profile.selected_norisk_pack_id.as_deref() == Some("norisk-dev") {
            info!(
                "Migrating profile '{}' (ID: {}) from norisk-dev to norisk-prod",
                profile.name, profile.id
            );

            profile.selected_norisk_pack_id = Some("norisk-prod".to_string());
            migrated_count += 1;
        }
    }

    if migrated_count > 0 {
        info!(
            "Migration: Updated {} profiles from norisk-dev to norisk-prod",
            migrated_count
        );
    }

    migrated_count
}

fn raise_legacy_memory_default(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let target = crate::state::profile_state::default_memory_max_mb();
    if target <= LEGACY_DEFAULT_MEMORY_MAX_MB {
        return 0;
    }

    let mut migrated_count = 0;
    for (_, profile) in profiles.iter_mut() {
        if profile.settings.memory.max == LEGACY_DEFAULT_MEMORY_MAX_MB
            && profile.settings.memory.min == LEGACY_DEFAULT_MEMORY_MIN_MB
        {
            profile.settings.memory.max = target;
            migrated_count += 1;
        }
    }

    if migrated_count > 0 {
        info!(
            "Migration: Raised memory from {} MB to {} MB on {} profiles",
            LEGACY_DEFAULT_MEMORY_MAX_MB, target, migrated_count
        );
    }

    migrated_count
}

#[derive(Serialize, Deserialize, Default)]
struct Ledger {
    #[serde(default)]
    applied: Vec<String>,
    #[serde(flatten)]
    unknown: HashMap<String, serde_json::Value>,
}

fn ledger_path() -> PathBuf {
    LAUNCHER_DIRECTORY
        .meta_dir()
        .join("applied_migrations.json")
}

fn read_ledger(path: &Path) -> Ledger {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Ledger::default();
    };

    serde_json::from_str(&raw).unwrap_or_else(|e| {
        warn!("Ignoring unreadable migration ledger {:?}: {}", path, e);
        Ledger::default()
    })
}

fn write_ledger(path: &Path, ledger: &Ledger) {
    let written = serde_json::to_vec(ledger)
        .map_err(|e| e.to_string())
        .and_then(|raw| {
            crate::utils::file_utils::write_atomic_sync(path, &raw).map_err(|e| e.to_string())
        });

    if let Err(e) = written {
        warn!("Could not record migrations in {:?}: {}", path, e);
    }
}

#[cfg(test)]
#[path = "migration_utils_test.rs"]
mod tests;
