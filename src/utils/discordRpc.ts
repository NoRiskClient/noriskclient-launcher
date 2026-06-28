import { invoke } from "@tauri-apps/api/core";

export function setDiscordState(state: string) {
  invoke("set_discord_state", { stateType: state }).catch(() => {});
}
