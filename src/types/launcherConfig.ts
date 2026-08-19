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

export type ClipEncoder = "auto" | "nvenc" | "amf" | "quick_sync" | "software";

export type AudioSourceChoice = 'system' | 'game_only' | 'both';

export interface AudioDeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
}

export type ClipCodec = "h264" | "h265" | "av1";

export type QualityPreset = "low" | "standard" | "high" | "custom";

export interface EncoderCapability {
  codec: ClipCodec;
  encoder: ClipEncoder;
  available: boolean;
  hardware: boolean;
  detail: string | null;
}

export interface QualitySpec {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, "custom">, QualitySpec> = {
  low: { width: 640, height: 360, fps: 24, bitrateKbps: 2_000 },
  standard: { width: 1280, height: 720, fps: 60, bitrateKbps: 7_000 },
  high: { width: 1920, height: 1080, fps: 60, bitrateKbps: 12_000 },
};

export const CUSTOM_RESOLUTIONS: ReadonlyArray<{ width: number; height: number; label: string }> = [
  { width: 640, height: 360, label: "360p" },
  { width: 854, height: 480, label: "480p" },
  { width: 1280, height: 720, label: "720p" },
  { width: 1920, height: 1080, label: "1080p" },
];
export const CUSTOM_FPS: readonly number[] = [24, 30, 60, 120, 144];
export const CUSTOM_BITRATES_KBPS: readonly number[] = [
  3_000, 5_000, 7_000, 10_000, 15_000, 20_000, 25_000, 30_000, 50_000, 70_000, 100_000,
];

export interface ClipConfig {
  enabled: boolean;
  quality: QualityPreset | null;
  width: number;
  height: number;
  fps: number;
  bitrate_kbps: number;
  codec: ClipCodec;
  encoder: ClipEncoder;
  capture_audio: boolean;
  audio_source: AudioSourceChoice;
  audio_device_id: string | null;
  game_volume: number;
  other_volume: number;
  capture_microphone: boolean;
  microphone_device_id: string | null;
  microphone_volume: number;
  output_dir: string | null;
  max_storage_gb: number;
  pre_roll_seconds: number;
  post_roll_seconds: number;
  hotkey_save: string;
  hotkey_toggle: string;
}

export interface CaptureStatus {
  running: boolean;
  state:
    | "idle"
    | "attaching"
    | "buffering"
    | "paused"
    | "blocked_fullscreen_exclusive"
    | "failed";
  blocked_by_fullscreen: boolean;
  engine_version: string | null;
  adapter: string | null;
  available_encoders: ClipEncoder[];
  capabilities: EncoderCapability[];
  active_codec: ClipCodec | null;
  active_encoder: ClipEncoder | null;
  audio_devices: AudioDeviceInfo[];
  microphones: AudioDeviceInfo[];
  supports_game_only_audio: boolean;
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
  clips: ClipConfig;
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