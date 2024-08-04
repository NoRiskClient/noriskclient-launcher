import { get } from "svelte/store";
import { defaultUser } from "../stores/credentialsStore.js";
import { launcherOptions } from "../stores/optionsStore.js";
import { noriskLog } from "./noriskUtils.js";
import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";

export async function openDiscordIntegration() {
  let credentials = get(defaultUser);
  let options = get(launcherOptions);
  if (!credentials) return;
  if (!options) return;
  noriskLog("Opening Discord Integration");
  return await invoke("discord_auth_link", { options, credentials })
    .then(() => {
      noriskLog("Closed Discord Integration");
    })
    .catch((error) => {
      addNotification(error);
    });
}

