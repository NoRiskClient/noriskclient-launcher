import { invoke } from "@tauri-apps/api";
import { launcherOptions } from "./optionsStore.js";
import { writable } from "svelte/store";

export const branches = writable([]);

export async function fetchBranches() {
  await invoke("request_norisk_branches").then(result => {
    const latestBranch = launcherOptions.experimentalMode ? launcherOptions.latestDevBranch : launcherOptions.latestBranch;
    result.sort(function(a, b) {
      if (a === latestBranch) {
        return -1;
      } else if (b === latestBranch) {
        return 1;
      } else {
        return a.localeCompare(b);
      }
    });
    branches.set(result);
  }).catch((reason) => {
    branches.set([])
    //addNotification(reason);
  });
}
