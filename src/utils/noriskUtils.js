import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get, writable } from "svelte/store";
import { launcherOptions, saveOptions } from "../stores/optionsStore.js";
import { pop, push } from "svelte-spa-router";
import { defaultUser, fetchDefaultUserOrError } from "../stores/credentialsStore.js";
import { profiles } from "../stores/profilesStore.js";

export const isClientRunning = writable(false);
export const isCheckingForUpdates = writable(true);
export const startProgress = writable({
  progressBarMax: 0,
  progressBarProgress: 0,
  progressBarLabel: "",
});

export async function runClient(branch) {
  if (get(isClientRunning)) {
    addNotification("Client is already running");
    return;
  }
  noriskLog("Client started");

  let options = get(launcherOptions);
  let launcherProfiles = get(profiles);
  let installedMods = [];

  if (options.experimentalMode) {
    options.latestDevBranch = branch;
  } else {
    options.latestBranch = branch;
  }

  await saveOptions();

  await push("/start-progress");

  let launcherProfile;
  if (options.experimentalMode) {
    const activeProfileId = launcherProfiles.selectedExperimentalProfiles[branch];
    launcherProfile = launcherProfiles.experimentalProfiles.find(p => p.id === activeProfileId);
  } else {
    const activeProfileId = launcherProfiles.selectedMainProfiles[branch];
    launcherProfile = launcherProfiles.mainProfiles.find(p => p.id === activeProfileId);
  }

  launcherProfile?.mods?.forEach(mod => {
    noriskLog(`Pushing Mod: ${JSON.stringify(mod.value)}`);
    installedMods.push(mod.value);
    mod.dependencies.forEach((dependency) => {
      noriskLog(`Pushing Dependency: ${JSON.stringify(dependency.value)}`);
      installedMods.push(dependency.value);
    });
  });

  await invoke("run_client", {
    branch: branch,
    options: options,
    mods: installedMods,
    shaders: get(profiles)?.addons[branch]?.shaders ?? [],
    resourcepacks: get(profiles)?.addons[branch]?.resourcePacks ?? [],
    datapacks: get(profiles)?.addons[branch]?.datapacks ?? [],
  }).then(() => {
    isClientRunning.set(true);
  }).catch(reason => {
    isClientRunning.set(false);
    console.error("Error: ", reason);
    pop();
    addNotification(reason);
  });

  // NoRisk Token Changed So Update
  await fetchDefaultUserOrError(false)
}

export async function stopClient() {
  push("/");
  await invoke("terminate").catch(reason => {
    addNotification(reason);
  });
}

export async function openMinecraftLogsWindow() {
  await invoke("open_minecraft_logs_window").catch(reason => {
    addNotification(reason);
  });
}

export function getNoRiskToken() {
  let options = get(launcherOptions);
  let user = get(defaultUser);
  return options.experimentalMode ? user.norisk_credentials.experimental.value : user.norisk_credentials.production.value;
}

export function noriskLog(message) {
  console.log(message);
  invoke("console_log_info", { message }).catch(e => console.error(e));
}

export function noriskError(message) {
  console.error(message);
  invoke("console_log_error", { message }).catch(e => console.error(e));
}
