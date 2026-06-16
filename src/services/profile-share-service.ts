import type { Profile } from "../types/profile";
import {
  addModrinthModToProfile,
  createProfile,
  getProfile,
  setProfileModEnabled,
  updateProfile,
} from "./profile-service";

const API_BASE = "https://fullrisk.net/api/v1";

export interface SharedProfileResponse {
  code: string;
  expiresAt: string;
}

export interface SharedProfileImportResponse extends SharedProfileResponse {
  profile: Pick<
    Profile,
    | "name"
    | "game_version"
    | "loader"
    | "loader_version"
    | "selected_norisk_pack_id"
    | "mods"
    | "disabled_norisk_mods_detailed"
    | "norisk_information"
    | "modpack_info"
  > & Partial<Pick<Profile, "description" | "group" | "use_shared_minecraft_folder">>;
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
      description: profile.description,
      group: profile.group,
      use_shared_minecraft_folder: profile.use_shared_minecraft_folder,
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

export async function getSharedProfile(code: string): Promise<SharedProfileImportResponse> {
  const normalizedCode = code.trim().toUpperCase();
  const response = await fetch(
    `${API_BASE}/launcher/profile-shares/${encodeURIComponent(normalizedCode)}`,
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function importSharedProfile(code: string): Promise<string> {
  const share = await getSharedProfile(code);
  const sharedProfile = share.profile;

  const newProfileId = await createProfile({
    name: `${sharedProfile.name} (shared)`,
    game_version: sharedProfile.game_version,
    loader: sharedProfile.loader,
    loader_version: sharedProfile.loader_version ?? undefined,
    selected_norisk_pack_id: sharedProfile.selected_norisk_pack_id ?? undefined,
    use_shared_minecraft_folder: sharedProfile.use_shared_minecraft_folder ?? false,
  });

  await updateProfile(newProfileId, {
    description: sharedProfile.description ?? null,
    group: sharedProfile.group ?? null,
    norisk_information: sharedProfile.norisk_information ?? null,
  });

  const disabledModrinthKeys = new Set<string>();
  for (const mod of sharedProfile.mods ?? []) {
    if (!mod.enabled && mod.source.type === "modrinth") {
      disabledModrinthKeys.add(`${mod.source.project_id}:${mod.source.version_id}`);
    }

    if (mod.source.type !== "modrinth") {
      continue;
    }

    await addModrinthModToProfile(
      newProfileId,
      mod.source.project_id,
      mod.source.version_id,
      mod.source.file_name,
      mod.source.download_url,
      mod.source.file_hash_sha1 ?? undefined,
      mod.display_name ?? undefined,
      mod.version ?? undefined,
      mod.associated_loader ? [mod.associated_loader] : undefined,
      mod.game_versions ?? undefined,
    );
  }

  if (disabledModrinthKeys.size > 0) {
    const importedProfile = await getProfile(newProfileId);
    for (const mod of importedProfile.mods) {
      if (mod.source.type !== "modrinth") continue;
      const key = `${mod.source.project_id}:${mod.source.version_id}`;
      if (disabledModrinthKeys.has(key)) {
        await setProfileModEnabled(newProfileId, mod.id, false);
      }
    }
  }

  return newProfileId;
}
