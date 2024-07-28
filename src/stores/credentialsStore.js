import { invoke } from "@tauri-apps/api";
import { addNotification } from "./notificationStore.js";
import { writable, get } from "svelte/store";
import { noriskError, noriskLog } from "../utils/noriskUtils.js";

export const defaultUser = writable();
export const users = writable([]);

export async function fetchDefaultUserOrError(printError = false) {
  await fetchUsers();
  return await invoke("minecraft_auth_get_default_user").then(async value => {
    defaultUser.set(value);
  }).catch((reason) => {
    defaultUser.set();
    noriskError("Default User Error: " + reason);
    if (printError === true) {
      addNotification(reason);
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
  console.log("Removing User", account);
  return await invoke("minecraft_auth_remove_user", { uuid: account.id }).catch((reason) => {
    addNotification(reason);
  });
}

export async function updateMojangAndNoRiskToken(credentials) {
  console.log("Updating Mojang And NoRisk Token", credentials);
  return await invoke("minecraft_auth_update_mojang_and_norisk_token", { credentials }).catch((reason) => {
    addNotification(reason);
  });
}

export async function updateNoRiskToken(credentials) {
  console.log("Updating NoRisk Token", credentials);
  return await invoke("minecraft_auth_update_norisk_token", { credentials }).catch((reason) => {
    addNotification(reason);
  });
}
