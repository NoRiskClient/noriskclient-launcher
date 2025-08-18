// This file is auto-generated from the Rust sources. Do not edit manually.
// Corresponding Rust file: src-tauri/src/state/config_state.rs

export interface Hooks {
  pre_launch: string | null; // Option<String>
  wrapper: string | null; // Option<String>
  post_exit: string | null; // Option<String>
}

export interface MemorySettings {
  min: number; // u32
  max: number; // u32
}

export interface LauncherConfig {
  version: number; // u32
  is_experimental: boolean;
  auto_check_updates: boolean;
  concurrent_downloads: number; // usize
  enable_discord_presence: boolean;
  check_beta_channel: boolean; // Added from Rust struct
  profile_grouping_criterion: string | null; // Option<String>
  open_logs_after_starting: boolean;
  concurrent_io_limit: number; // usize
  hooks: Hooks;
  hide_on_process_start: boolean;
  global_memory_settings: MemorySettings;
  custom_game_directory: string | null; // Option<PathBuf>
} 