import { invoke } from "@tauri-apps/api/core";

import { iconUrlForUuid, creatorCodeIconUrl } from "../lib/cosmetics/cosmeticIcons";

const CREATOR_CODE_VALID_MS = 14 * 24 * 60 * 60 * 1000;

export interface SelectedIcon {
  url: string | null;
  plus: boolean;
}

async function getPlusStatus(uuid: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.norisk.gg/api/v1/core/user/${uuid}/plus-status`
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { isNoRiskPlus?: boolean };
    return body.isNoRiskPlus === true;
  } catch {
    return false;
  }
}

const CREATOR_CODE_ICON_UUID = "1e441d2b-c975-43b8-aeee-e46dd0dfd216";

async function isCreatorCodeIconUnlocked(code: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.norisk.gg/api/v1/cosmetics/support-a-creator-code/${encodeURIComponent(
        code
      )}/rewards`
    );
    if (!res.ok) return false;
    const body = (await res.json()) as {
      rewards?: { creatorCodeIcon?: { isUnlocked?: boolean } };
    };
    return body.rewards?.creatorCodeIcon?.isUnlocked === true;
  } catch {
    return false;
  }
}

export async function getSelectedIcon(
  playerIdentifier: string
): Promise<SelectedIcon> {
  const [iconRes, plus, creatorCode] = await Promise.all([
    invoke<{ currentIcon?: string | null }>("get_player_icon", {
      payload: { player_identifier: playerIdentifier },
    }).catch(() => null),
    getPlusStatus(playerIdentifier),
    getActiveCreatorCode().catch(() => null),
  ]);

  const currentIcon = iconRes?.currentIcon ?? null;
  let url = iconUrlForUuid(currentIcon);

  if (currentIcon === CREATOR_CODE_ICON_UUID && creatorCode?.code) {
    const unlocked = await isCreatorCodeIconUnlocked(creatorCode.code);
    if (unlocked) url = creatorCodeIconUrl(creatorCode.code);
  }

  return { url, plus };
}

export interface ActiveCreatorCode {
  code: string;
  isValid: boolean;
  hasValidIcon: boolean;
  iconUrl: string | null;
}

export async function getActiveCreatorCode(): Promise<ActiveCreatorCode | null> {
  try {
    const info = await invoke<{
      code?: string;
      addTimestamp?: number;
      hasValidIcon?: boolean;
    } | null>("get_active_creator_code");
    if (!info?.code) return null;

    const isValid =
      typeof info.addTimestamp === "number" &&
      Date.now() - info.addTimestamp < CREATOR_CODE_VALID_MS;
    const hasValidIcon = !!info.hasValidIcon;

    return {
      code: info.code,
      isValid,
      hasValidIcon,
      iconUrl: hasValidIcon ? creatorCodeIconUrl(info.code) : null,
    };
  } catch {
    return null;
  }
}
