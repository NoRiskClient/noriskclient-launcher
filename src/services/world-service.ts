import { invoke } from "@tauri-apps/api/core";

// Import necessary types (adjust paths if needed)
import type {
    WorldInfo,
    ServerInfo,
    ServerPingInfo
} from '../types/minecraft';
import type {
    CopyWorldParams // Assuming this is defined in profile types
} from '../types/profile';

/**
 * Fetches the list of servers associated with a specific profile.
 */
export const getServersForProfile = (profileId: string): Promise<ServerInfo[]> => {
  console.debug(`[WorldService] Fetching servers for profile: ${profileId}`);
  return invoke('get_servers_for_profile', { profileId });
};

/**
 * Fetches the list of worlds associated with a specific profile.
 */
export const getWorldsForProfile = (profileId: string): Promise<WorldInfo[]> => {
  console.debug(`[WorldService] Fetching worlds for profile: ${profileId}`);
  return invoke('get_worlds_for_profile', { profileId });
};

/**
 * Pings a Minecraft server to get its status.
 */
export const pingMinecraftServer = (address: string): Promise<ServerPingInfo> => {
  console.debug(`[WorldService] Pinging server: ${address}`);
  return invoke('ping_minecraft_server', { address });
};

/**
 * Copies a world from one profile to another (or within the same profile).
 */
export const copyWorld = (params: CopyWorldParams): Promise<string> => {
  console.debug(`[WorldService] Copying world: ${params.source_world_folder} to profile ${params.target_profile_id} as ${params.target_world_name}`);
  return invoke('copy_world', { params });
};

/**
 * Imports a Minecraft world from an external path into a profile's saves directory.
 */
export const importWorld = (profileId: string, sourceWorldPath: string, targetWorldName: string): Promise<string> => {
  console.debug(`[WorldService] Importing world from ${sourceWorldPath} to profile ${profileId} as ${targetWorldName}`);
  return invoke('import_world', { 
    params: {
      profile_id: profileId,
      source_world_path: sourceWorldPath,
      target_world_name: targetWorldName,
    }
  });
};

/**
 * Deletes a specific world from a profile.
 */
export const deleteWorld = (profileId: string, worldFolder: string): Promise<void> => {
  console.debug(`[WorldService] Deleting world: ${worldFolder} from profile ${profileId}`);
  return invoke('delete_world', { profileId, worldFolder });
};

/**
 * Checks if a world's session.lock file can be acquired, indicating if it's likely in use.
 * @returns A promise that resolves with true if the world is locked, false otherwise.
 */
export const checkWorldLockStatus = (profileId: string, worldFolder: string): Promise<boolean> => {
    console.debug(`[WorldService] Checking lock status for world: ${worldFolder} in profile ${profileId}`);
    return invoke('check_world_lock_status', { profileId, worldFolder });
};

// --- Frontend Helper Functions ---

/**
 * Converts a numeric game mode ID to a display string.
 */
export const getGameModeString = (mode: number | null | undefined): string => {
  if (mode === null || typeof mode === 'undefined') return 'Unknown';
  switch (mode) {
    case 0: return 'Survival';
    case 1: return 'Creative';
    case 2: return 'Adventure';
    case 3: return 'Spectator';
    default: return `Unknown (${mode})`;
  }
};

/**
 * Converts a numeric difficulty ID to a display string.
 */
export const getDifficultyString = (difficulty: number | null | undefined): string => {
  if (difficulty === null || typeof difficulty === 'undefined') return 'Unknown';
  switch (difficulty) {
    case 0: return 'Peaceful';
    case 1: return 'Easy';
    case 2: return 'Normal';
    case 3: return 'Hard';
    default: return `Unknown (${difficulty})`;
  }
}; 