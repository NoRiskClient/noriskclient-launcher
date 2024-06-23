import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get } from "svelte/store";
import { launcherOptions } from "../stores/optionsStore.js";

export async function runClient(branch) {
  console.log("Client started");
  let options = get(launcherOptions);
  let installedMods = [];

  await invoke("run_client", {
    branch: branch,
    options: options,
    mods: installedMods,
    shaders: [],
    resourcepacks: [],
    datapacks: [],
  }).catch(reason => {
    console.error("Error: ", reason);
    addNotification(reason);
  });
}
