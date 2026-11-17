import { invoke } from "@tauri-apps/api/core";
import type { CrashAction } from "../types/crash-analysis";

/**
 * Thin wrappers over the Rust crash-fix commands. All logic (mod matching, version resolution,
 * apply + revert) lives in crash_fix_command.rs. The fix token is opaque — keep it for revert.
 */

export type AppliedFix = unknown; // opaque revert token from Rust

export type ApplyOutcome =
  | { status: "applied"; fix: AppliedFix }
  | { status: "skipped"; reason: string };

export function applyCrashFix(profileId: string, action: CrashAction): Promise<ApplyOutcome> {
  return invoke<ApplyOutcome>("apply_crash_fix", { profileId, action });
}

export function revertCrashFix(applied: AppliedFix): Promise<void> {
  return invoke<void>("revert_crash_fix", { applied });
}
