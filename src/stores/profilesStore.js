import { get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api";
import { addNotification } from "./notificationStore.js";
import { launcherOptions } from "./optionsStore.js";
import { v4 as uuidv4 } from "uuid";
import { branches } from "./branchesStore.js";
import { noriskLog } from "../utils/noriskUtils.js";

export const profiles = writable();

export async function fetchProfiles() {
  await invoke("get_launcher_profiles").then((result) => {
    console.info(`Loaded launcher profiles: `, result);
    get(branches).forEach(branch => {
      if (get(launcherOptions).experimentalMode) {
        const branchProfile = result.experimentalProfiles.find(p => p.branch === branch);
        if (!branchProfile) {
          const profileId = uuidv4();
          result.experimentalProfiles.push({
            id: profileId,
            branch: branch,
            name: `${branch} - Default`,
            mods: [],
          });
          result.selectedExperimentalProfiles[branch] = profileId;
        }
      } else {
        const branchProfile = result.mainProfiles.find(p => p.branch === branch);
        if (!branchProfile) {
          const profileId = uuidv4();
          result.mainProfiles.push({
            id: profileId,
            branch: branch,
            name: `${branch} - Default`,
            mods: [],
          });
          result.selectedMainProfiles[branch] = profileId;
        }
      }
      const branchAddons = result.addons[branch];
      if (!branchAddons) {
        result.addons[branch] = {
          shaders: [],
          resourcePacks: [],
          datapacks: [],
        };
      }
    });

    result.store = function() {
      console.debug("Storing Launcher Profiles: ", result);
      noriskLog("Storing Launcher Profiles...");
      invoke("store_launcher_profiles", { launcherProfiles: result }).catch(e => addNotification(e));
    };

    result.store();
    profiles.set(result);
  }).catch((error) => {
    addNotification("Failed to load launcher profiles: " + error);
  });
}
