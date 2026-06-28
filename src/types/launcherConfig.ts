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

/** Referral tracking state - keeps code even after redemption for tracing */
export interface ReferralState {
  /** The download UUID from the installer filename */
  code: string;
  /** Whether the code has been successfully reported to backend */
  redeemed: boolean;
  /** Timestamp when the code was redeemed (seconds since epoch) */
  redeemed_at: number | null;
  /** Account UUID that redeemed the code */
  redeemed_by_account: string | null;
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
  global_custom_jvm_args: string | null; // Option<String> - Global JVM args for standard profiles
  custom_game_directory: string | null; // Option<PathBuf>
  enable_analytics: boolean;
  use_browser_based_login: boolean;
  cache_natives_extraction: boolean;
  referral_state: ReferralState | null; // Referral tracking state
  last_played_profile: string | null; // Option<Uuid>
  pack_rollout_override: "auto" | "off" | "on";
}

export interface ReferralInfo {
  /** Display name of the referrer (username, creator name, etc.) */
  referrerName: string;
  /** Optional avatar/profile picture URL */
  referrerAvatar: string | null;
  /** Whether the referral code is still valid */
  valid: boolean;
  /** Type of referral: "friend", "affiliate", "creator", "partner", etc. */
  referralType: string | null;
  /** Translation key for the banner message (e.g., "referral.invited_by_friend") */
  translationKey: string | null;
  /** Fallback message if translation not found */
  fallbackMessage: string | null;
  /** Optional custom message from the referrer/backend */
  customMessage: string | null;
  /** Optional reward description (e.g., "Du erhältst 100 Coins!") */
  rewardText: string | null;
} 