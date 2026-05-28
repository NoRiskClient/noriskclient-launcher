import type { Profile } from "../types/profile";

const API_BASE = "https://fullrisk.net/api/v1";

export interface SharedProfileResponse {
  code: string;
  expiresAt: string;
}

export async function shareProfile(
  profile: Profile,
  ttlHours = 24,
): Promise<SharedProfileResponse> {
  const payload = {
    ttlHours,
    profile: {
      name: profile.name,
      game_version: profile.game_version,
      loader: profile.loader,
      loader_version: profile.loader_version,
      selected_norisk_pack_id: profile.selected_norisk_pack_id,
      mods: profile.mods,
      disabled_norisk_mods_detailed: profile.disabled_norisk_mods_detailed,
      norisk_information: profile.norisk_information,
      modpack_info: profile.modpack_info,
    },
  };

  const response = await fetch(`${API_BASE}/launcher/profile-shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}
