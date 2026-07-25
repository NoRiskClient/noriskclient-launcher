import { invoke } from "@tauri-apps/api/core";

export interface SelectedIcon {
  url: string | null;
  plus: boolean;
}

export interface ActiveCreatorCode {
  code: string;
  isValid: boolean;
  hasValidIcon: boolean;
  iconUrl: string | null;
}

export async function getSelectedIcon(
  playerIdentifier: string
): Promise<SelectedIcon> {
  try {
    return await invoke<SelectedIcon>("get_selected_player_icon", {
      playerIdentifier,
    });
  } catch {
    return { url: null, plus: false };
  }
}

export async function getActiveCreatorCode(): Promise<ActiveCreatorCode | null> {
  try {
    return await invoke<ActiveCreatorCode | null>("get_active_creator_code");
  } catch {
    return null;
  }
}
