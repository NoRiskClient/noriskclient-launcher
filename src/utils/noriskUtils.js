import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get, writable } from "svelte/store";
import { launcherOptions } from "../stores/optionsStore.js";
import { pop, push } from "svelte-spa-router";
import { defaultUser } from "../stores/credentialsStore.js";
import { profiles } from "../stores/profilesStore.js";

export const isClientRunning = writable(false);

export async function runClient(branch) {
  console.log("Client started");
  push("/start-progress");

  let options = get(launcherOptions);
  let installedMods = [];
  isClientRunning.set(true)

  await invoke("run_client", {
    branch: branch,
    options: options,
    mods: installedMods,
    shaders: get(profiles).addons[branch].shaders,
    resourcepacks: get(profiles).addons[branch].resourcePacks,
    datapacks: get(profiles).addons[branch].datapacks
  }).catch(reason => {
    isClientRunning.set(false)
    console.error("Error: ", reason);
    pop();
    addNotification(reason);
  });
}

export async function stopClient() {
  push("/");
  await invoke("terminate").catch(reason => {
    addNotification(reason);
  });
}

export function getNoRiskToken() {
  let options = get(launcherOptions);
  let user = get(defaultUser);
  return options.experimentalMode ? user.norisk_credentials.experimental.value : user.norisk_credentials.production.value;
}
