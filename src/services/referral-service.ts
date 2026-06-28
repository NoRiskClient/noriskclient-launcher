import { invoke } from "@tauri-apps/api/core";
import type { ReferralInfo } from "../types/launcherConfig";

/**
 * Fetches information about a referral code from the backend.
 * This is a public endpoint that doesn't require authentication.
 * @param code The referral code (UUID) to look up
 * @returns A promise that resolves with the ReferralInfo
 */
export async function getReferralInfo(code: string): Promise<ReferralInfo> {
  try {
    const info = await invoke<ReferralInfo>("get_referral_info", { code });
    console.log("[ReferralService] Fetched referral info:", info);
    return info;
  } catch (error) {
    console.error("[ReferralService] Failed to get referral info:", error);
    throw error;
  }
}
