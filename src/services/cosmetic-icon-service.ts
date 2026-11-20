import { invoke } from "@tauri-apps/api/core";

export interface SelectedIcon {
  url: string | null;
  plus: boolean;
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

export async function getSelectedIconCached(
  playerIdentifier: string
): Promise<SelectedIcon | null> {
  try {
    return await invoke<SelectedIcon | null>("get_selected_player_icon_cached", {
      playerIdentifier,
    });
  } catch {
    return null;
  }
}
