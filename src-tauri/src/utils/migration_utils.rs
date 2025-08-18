use crate::state::profile_state::Profile;
use log::{info, warn};
use std::collections::HashMap;
use uuid::Uuid;

/// Performs profile migrations during startup.
/// Currently handles:
/// - Migration from "norisk-dev" to "norisk-prod" pack IDs
pub fn migrate_profiles(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let mut migration_count = 0;
    
    // Migration 1: norisk-dev → norisk-prod
    migration_count += migrate_norisk_pack_ids(profiles);
    
    if migration_count > 0 {
        info!("ProfileManager: Completed profile migrations. Total changes: {}", migration_count);
    }
    
    migration_count
}

/// Migrates profiles from "norisk-dev" to "norisk-prod" pack ID
fn migrate_norisk_pack_ids(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let mut migrated_count = 0;
    
    for (_, profile) in profiles.iter_mut() {
        if profile.selected_norisk_pack_id == Some("norisk-dev".to_string()) {
            info!(
                "Migrating profile '{}' (ID: {}) from norisk-dev to norisk-prod", 
                profile.name, 
                profile.id
            );
            
            profile.selected_norisk_pack_id = Some("norisk-prod".to_string());
            migrated_count += 1;
        }
    }
    
    if migrated_count > 0 {
        info!("Migration: Updated {} profiles from norisk-dev to norisk-prod", migrated_count);
    }
    
    migrated_count
}