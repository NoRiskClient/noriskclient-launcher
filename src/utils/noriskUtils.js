import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get, writable } from "svelte/store";
import { launcherOptions, saveOptions } from "../stores/optionsStore.js";
import { pop, push } from "svelte-spa-router";
import { defaultUser, fetchDefaultUserOrError } from "../stores/credentialsStore.js";
import { profiles } from "../stores/profilesStore.js";

export const noriskUser = writable(null);
export const isInMaintenanceMode = writable(null);
export const isClientRunning = writable(false);
export const isCheckingForUpdates = writable(true);
export const startProgress = writable({
  progressBarMax: 0,
  progressBarProgress: 0,
  progressBarLabel: "",
});
export const featureWhitelist = writable([]);
export const customServerProgress = writable({});
export const forceServer = writable("");

export async function checkApiStatus() {
  let apiIsOnline = null;
  await invoke("check_online_status").then((apiOnlineState) => {
    apiIsOnline = apiOnlineState;
    noriskLog(`API is ${apiIsOnline ? 'online' : 'offline'}!`);
  }).catch(() => {
    apiIsOnline = false;
    noriskError("API is offline!");
  });
  return apiIsOnline;
}

export async function checkIfClientIsRunning() {
  await invoke("is_client_running").then((isRunning) => {
    noriskLog(`IsClientRunning is ${isRunning}`);
    isClientRunning.set(isRunning)
  }).catch((reason) => {
    noriskError(reason);
  });
}


export async function runClient(branch, checkedForNewBranch = false) {
  if (get(isClientRunning)) {
    addNotification("Client is already running");
    return;
  }

  if (!checkedForNewBranch) {
    let showNewBranchScreen;

    await invoke("check_for_new_branch", { branch: branch }).then(result => {
      noriskLog("Checked for new branch: " + result);
      showNewBranchScreen = result;
    }).catch(reason => {
      showNewBranchScreen = "ERROR";
      addNotification(reason);
    });

    if (showNewBranchScreen === "ERROR") {
      return;
    } else if (showNewBranchScreen == null) {
      await push("/first-install");
      return;
    } else if (showNewBranchScreen) {
      await push("/new-branch");
      return;
    }
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
    forceServer: get(forceServer).length > 0 ? get(forceServer) : null,
    mods: installedMods,
    shaders: get(profiles)?.addons[branch]?.shaders ?? [],
    resourcepacks: get(profiles)?.addons[branch]?.resourcePacks ?? [],
    datapacks: get(profiles)?.addons[branch]?.datapacks ?? [],
  }).then(() => {
    isClientRunning.set(true);
    if (get(forceServer).length > 0) {
      forceServer.set(get(forceServer) + ":RUNNING");
    }
  }).catch(error => {
    isClientRunning.set(false);
    forceServer.set("");
    pop();
    addNotification("Failed to run client: " + error);
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
  return options.experimentalMode ? user.norisk_credentials.experimental?.value ?? null : user.norisk_credentials.production?.value ?? null;
}

export function getNoRiskUser() {
  const user = get(defaultUser);
  if (!user) return;

  invoke("get_norisk_user", {
    options: get(launcherOptions),
    credentials: get(defaultUser),
  }).then(result => {
    result.isDev = result?.rank == "DEVELOPER" || result?.rank == "ADMIN";
    noriskUser.set(result);
    noriskLog("NoRisk User: " + JSON.stringify(result));
  }).catch(reason => {
    addNotification(`Failed to fetch NoRisk User: ${reason}`);
  });
}

export function noriskLog(message) {
  console.info(`Norisk Log: ${message}`);
  invoke("console_log_info", { message }).catch(e => console.error(e));
}

export function noriskWarning(message) {
  console.warn(`Norisk Warning: ${message}`);
  invoke("console_log_warning", { message }).catch(e => console.error(e));
}

export function noriskError(message) {
  console.error(`Norisk Error: ${message}`);
  invoke("console_log_error", { message }).catch(e => console.error(e));
}

export async function setForceServer(server) {
  forceServer.set(server);
}

export async function setCustomServerProgress(serverId, progress) {
  let currentProgress = get(customServerProgress);
  currentProgress[serverId] = progress;
  customServerProgress.set(currentProgress);
}

export async function getFeatureWhitelist() {
  featureWhitelist.set([]);
  const user = get(defaultUser);
  if (!user) return;

  await invoke("get_full_feature_whitelist", {
    options: get(launcherOptions),
    credentials: user,
  }).then(result => {
    if (!result || result.length < 1) return;
    featureWhitelist.set(result);
  }).catch(reason => {
    addNotification(`Failed to fetch Feature: ${reason}`);
  });
  noriskLog("Feature Whitelist: " + get(featureWhitelist).join(", "));
}

export async function getMaintenanceMode() {
  invoke("check_maintenance_mode").then(result => {
    if (result == true && get(noriskUser)?.isDev && get(isInMaintenanceMode) == null) {
      addNotification(`Skipped maintenance mode screen because you are a ${get(noriskUser).rank.toLowerCase()}.`, "INFO");
    }
    isInMaintenanceMode.set(result);
    noriskLog("Maintenance Mode: " + result);
  }).catch(reason => {
    addNotification(`Failed to fetch Maintenance Mode: ${reason}`);
  });
}

export function setMaintenanceMode(mode) {
  isInMaintenanceMode.set(mode);
}
