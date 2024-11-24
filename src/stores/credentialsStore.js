import { invoke } from "@tauri-apps/api";
import { addNotification } from "./notificationStore.js";
import { writable } from "svelte/store";
import { noriskError, noriskLog } from "../utils/noriskUtils.js";

export const defaultUser = writable(null);
export const users = writable([]);

export async function fetchDefaultUserOrError(printError = false) {
  /*await fetchUsers().catch((reason) => {
    addNotification(reason);
  });*/
  return await invoke("minecraft_auth_get_default_user").then(async value => {
    defaultUser.set(value);
  }).catch((error) => {
    defaultUser.set();
    if (printError === true) {
      addNotification("Default User Error: " + error);
    } else {
      noriskError("Default User Error: " + error);
    }
  });
}

export async function fetchUsers() {
  return await invoke("minecraft_auth_users").then(value => {
    value.sort((a, b) => a.id.localeCompare(b.id)); // Sortiere die Benutzer nach ihrer ID
    users.set(value);
  }).catch((reason) => {
    addNotification(reason);
  });
}

export async function setDefaultUser(account) {
  return await invoke("minecraft_auth_set_default_user", { uuid: account.id }).then(async value => {
    await fetchDefaultUserOrError();
  }).catch((reason) => {
    addNotification(reason);
  });
}

export async function removeUser(account) {
  noriskLog("Removing User: " + account.id);
  return await invoke("minecraft_auth_remove_user", { uuid: account.id });
}

export async function updateMojangAndNoRiskToken(credentials) {
  noriskLog("Updating Mojang And NoRisk Token");
  return await invoke("minecraft_auth_update_mojang_and_norisk_token", { credentials }).catch((reason) => {
    addNotification(reason);
  });
}

export async function updateNoRiskToken(credentials) {
  noriskLog("Updating NoRisk Token");
  return await invoke("minecraft_auth_update_norisk_token", { credentials }).catch((reason) => {
    addNotification(reason);
  });
}
