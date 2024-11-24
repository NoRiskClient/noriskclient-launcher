import { invoke } from "@tauri-apps/api";
import { addNotification } from "../stores/notificationStore.js";
import { get, writable } from "svelte/store";
import { launcherOptions, saveOptions } from "../stores/optionsStore.js";
import { pop, push } from "svelte-spa-router";
import { defaultUser, fetchDefaultUserOrError } from "../stores/credentialsStore.js";
import { profiles } from "../stores/profilesStore.js";
import { translations } from "./translationUtils";

export const version = writable("");
export const noriskUser = writable(null);
export const isInMaintenanceMode = writable(false);
export const isApiOnline = writable(true);
export const isClientRunning = writable([false, false]);
export const isCheckingForUpdates = writable(true);
export const clientInstances = writable([]);
export const featureWhitelist = writable([]);
export const customServerProgress = writable({});
export const forceServer = writable("");

export async function getVersion() {
  await invoke("get_launcher_version").then((v) => {
    version.set(v);
    noriskLog("Launcher Version: " + v);
  }).catch(reason => {
    addNotification(reason);
    noriskError(reason);
  });
}

export async function checkApiStatus() {
    return await invoke("check_online_status").then((apiOnlineState) => {
        isApiOnline.set(apiOnlineState);
        //noriskLog(`API is ${apiIsOnline ? "online" : "offline"}!`);
    }).catch(() => {
        isApiOnline.set(false);
        //noriskError("API is offline!");
    });
}

export async function getClientInstances() {
  return await invoke("get_running_instances").then(value => {
    clientInstances.set(value);
    //noriskLog(`Received Running Instances: ${JSON.stringify(value)}`);
  }).catch((reason) => {
    noriskError(reason);
  });
}

export async function runClient(branch, checkedForNewBranch = false) {
  let options = get(launcherOptions);

  if (!options.multipleInstances) {
    let instance = get(clientInstances).find(value => value.branch === branch);
    if (instance) {
      await push(`/start-progress/` + instance.id);
      return;
    }
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

  let launcherProfiles = get(profiles);
  let installedMods = [];

  if (options.experimentalMode) {
    options.latestDevBranch = branch;
  } else {
    options.latestBranch = branch;
  }

  await saveOptions();

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

  // Ensure keep local assets only exists if permission is granted
  getNoRiskUser();

  await invoke("run_client", {
    branch: branch,
    options: options,
    forceServer: get(forceServer).length > 0 ? get(forceServer) : null,
    mods: installedMods,
  }).then((uuid) => {
    noriskLog(`Started Instance ${uuid}`);
    push("/start-progress/" + uuid);
    if (get(forceServer).length > 0) {
      forceServer.set(get(forceServer) + ":RUNNING");
    }
  }).catch(error => {
    forceServer.set("");
    pop();
    addNotification(get(translations).app.notification.failedToRunClient.replace("{error}", error));
  });

  // NoRisk Token Changed So Update
  await fetchDefaultUserOrError(false);
}

export async function stopClient(instanceId) {
  push("/");
  await invoke("terminate", {
    instanceId,
  }).then(() => {
  }).catch(reason => {
    addNotification(reason);
  });
}

export async function openMinecraftLogsWindow(uuid) {
  let isLive = get(clientInstances).find(value => value.id === uuid)?.isAttached ?? false

  if (!isLive) {
    addNotification(get(translations).logs.notification.liveLogsUnavailable.info, "INFO", get(translations).logs.notification.liveLogsUnavailable.details);
  }

  return await invoke("open_minecraft_logs_window", { uuid, isLive }).catch(reason => {
    addNotification(reason);
  });
}

export function getNoRiskToken() {
  let options = get(launcherOptions);
  let user = get(defaultUser);
  return options.experimentalMode ? user.norisk_credentials.experimental?.value ?? null : user.norisk_credentials.production?.value ?? null;
}

export function getMcToken() {
  let user = get(defaultUser);
  return user.access_token ?? null;
}

export async function getNoRiskUser() {
  const user = get(defaultUser);
  if (!user) return false;
  if (!get(isApiOnline)) return false;

  let isTokenValid = false;
  await invoke("get_norisk_user", {
    options: get(launcherOptions),
    credentials: get(defaultUser),
  }).then(result => {
    result.isDev = result?.rank == "DEVELOPER" || result?.rank == "ADMIN";
    noriskUser.set(result);
    noriskLog("NoRisk User: " + JSON.stringify(result));
    isTokenValid = true;
  }).catch(reason => {
    if (!reason.includes("401")) {
      addNotification(`Failed to fetch NoRisk User: ${reason}`);
    }
  });

  return isTokenValid;
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
  if (!get(isApiOnline)) return false;

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
  if (!get(isApiOnline)) return;
  invoke("check_maintenance_mode").then(result => {
    if (result === true && get(noriskUser)?.isDev && get(isInMaintenanceMode) == null) {
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
