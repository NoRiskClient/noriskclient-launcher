import { invoke } from "@tauri-apps/api/core";
import { isMobile } from "../lib/platform";

export function setDiscordState(state: string) {
  if (isMobile) return;
  invoke("set_discord_state", { stateType: state }).catch(() => {});
}
