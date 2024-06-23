import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get } from "svelte/store";
import { launcherOptions } from "../stores/optionsStore.js";
import { pop, push } from "svelte-spa-router";
import { defaultUser } from "../stores/credentialsStore.js";

export async function runClient(branch) {
  console.log("Client started");
  push("/start-progress");

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
