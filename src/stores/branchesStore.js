import { invoke } from "@tauri-apps/api";
import { launcherOptions, saveOptions } from "./optionsStore.js";
import { get, writable } from "svelte/store";
import { defaultUser } from "./credentialsStore.js";
import { noriskLog } from "../utils/noriskUtils.js";

export const branches = writable([]);
export const currentBranchIndex = writable(0);

export async function fetchBranches() {
  let credentials = get(defaultUser);
  let options = get(launcherOptions);
  if (!credentials || !options) {
    branches.set([])
    return;
  }
  await invoke("request_norisk_branches", { options, credentials }).then(result => {
    const latestBranch = options?.experimentalMode ? options.latestDevBranch : options.latestBranch;
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
    branches.set([]);
    //addNotification(reason);
  });
  noriskLog("Fetches Branches: " + JSON.stringify(get(branches)));

  let latestBranch = options?.experimentalMode ? options?.latestDevBranch : options?.latestBranch;
  let _branches = get(branches);
  if (!latestBranch) {
    if (_branches.length > 0) {
      currentBranchIndex.set(0);
    }
  } else {
    let index = _branches.indexOf(latestBranch);
    if (index !== -1) {
      currentBranchIndex.set(index);
    } else {
      currentBranchIndex.set(0);
      const newBranch = get(branches)[get(currentBranchIndex)];
      if (get(launcherOptions).experimentalMode) {
        get(launcherOptions).latestDevBranch = newBranch;
      } else {
        get(launcherOptions).latestBranch = newBranch;
      }
      saveOptions(false);
    }
  }

  noriskLog("Current Branch: " + get(branches)[get(currentBranchIndex)])
}

export function switchBranch(isLeft) {
  const totalBranches = get(branches).length;
  if (totalBranches === 0) return
  if (isLeft) {
    currentBranchIndex.update(value => {
      return (value - 1 + totalBranches) % totalBranches;
    });
  } else {
    currentBranchIndex.update(value => {
      return (value + 1) % totalBranches;
    });
  }

  const newBranch = get(branches)[get(currentBranchIndex)];
  if (get(launcherOptions).experimentalMode) {
    get(launcherOptions).latestDevBranch = newBranch;
  } else {
    get(launcherOptions).latestBranch = newBranch;
  }
  saveOptions(false);
}
