import { ProcessMetadata } from "./processState";

export enum EventType {
  InstallingJava = "installing_java",
  DownloadingLibraries = "downloading_libraries",
  ExtractingNatives = "extracting_natives",
  DownloadingAssets = "downloading_assets",
  ReusingMinecraftAssets = "reusing_minecraft_assets",
  CopyingInitialData = "copying_initial_data",
  CopyingNoRiskClientAssets = "copying_norisk_client_assets",
  DownloadingNoRiskClientAssets = "downloading_norisk_client_assets",
  DownloadingClient = "downloading_client",
  InstallingFabric = "installing_fabric",
  InstallingQuilt = "installing_quilt",
  InstallingForge = "installing_forge",
  InstallingNeoForge = "installing_neoforge",
  PatchingForge = "patching_forge",
  DownloadingMods = "downloading_mods",
  SyncingMods = "syncing_mods",
  LaunchingMinecraft = "launching_minecraft",
  MinecraftOutput = "minecraft_output",
  AccountLogin = "account_login",
  AccountLoginStarted = "account_login_started",
  AccountLoginWaitingForBrowser = "account_login_waiting_for_browser",
  AccountLoginExchangingToken = "account_login_exchanging_token",
  AccountLoginExchangingXboxToken = "account_login_exchanging_xbox_token",
  AccountLoginExchangingXstsToken = "account_login_exchanging_xsts_token",
  AccountLoginGettingMinecraftToken = "account_login_getting_minecraft_token",
  AccountLoginCheckingEntitlements = "account_login_checking_entitlements",
  AccountLoginFetchingProfile = "account_login_fetching_profile",
  AccountLoginCompleted = "account_login_completed",
  AccountRefresh = "account_refresh",
  AccountLogout = "account_logout",
  ProfileUpdate = "profile_update",
  TriggerProfileUpdate = "trigger_profile_update",
  MinecraftProcessExited = "minecraft_process_exited",
  Error = "error",
  LaunchSuccessful = "launch_successful",
  CrashReportContentAvailable = "crash_report_content_available",
  MigrationStarted = "migration_started",
  MigrationCompleted = "migration_completed",
  MigrationFailed = "migration_failed",
  ExportingProfile = "exporting_profile",
  ProcessMetricsUpdate = "process_metrics_update",
  TaskProgress = "task_progress",
}

export interface EventPayload {
  event_id: string;
  event_type: EventType;
  target_id: string | null;
  message: string;
  progress: number | null;
  error: string | null;
}

export interface MinecraftProcessExitedPayload {
  profile_id: string;
  process_id: string;
  exit_code: number | null;
  success: boolean;
  process_metadata: ProcessMetadata | null;
  crash_report_content?: string;
}

export interface CrashReportContentAvailablePayload {
  process_id: string;
  content: string;
}

export interface ProcessMetricsPayload {
  process_id: string;
  memory_bytes: number;
  cpu_percent: number;
  timestamp: string;
}
