import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api";
import { addNotification } from "./notificationStore.js";
import { fetchBranches } from "./branchesStore.js";
import { noriskLog } from "../utils/noriskUtils.js";

export const launcherOptions = writable();

/*
  Hallo Kommentarleser, es ist 23 Uhr und ich habe probiert die Notifications wie in NoRiskClient zu coden
  mit hover und progressbar, anfang lief es auch GUT ABER DANN KAM ALLES JUNGE CHATGPT ABO ABGELAUFEN
  DER SCHREIBT NUR ROTZE DER STATE UPDATED SICH HELLWA WIRD JS SOWIEOS QUATSCH UND JETZT LASS ICH ES EINFAHC MIR SO EGAL FIX SELBST BITTE
  gute nacht <3
 */

export async function fetchOptions() {
  await invoke("get_options").then(async (result) => {
    result.toggleTheme = () => {
      let options = get(launcherOptions);
      if (options.theme === "LIGHT") {
        options.theme = "DARK";
        window.document.body.classList.add(
          "dark-mode",
        );
      } else {
        options.theme = "LIGHT";
        window.document.body.classList.remove(
          "dark-mode",
        );
      }
      launcherOptions.set(options)
    };

    if (result.theme === "DARK") {
      window.document.body.classList.add(
        "dark-mode",
      );
    } else {
      window.document.body.classList.remove(
        "dark-mode",
      );
    }

    launcherOptions.set(result);
  }).catch(reason => {
    addNotification(reason);
  });
}

export async function saveOptions(refreshBranches = true) {
  let options = get(launcherOptions);
  noriskLog("Saving Launcher Options: " + JSON.stringify(options));
  await invoke("store_options", {
    options,
  }).catch((e) => addNotification(e));
  if (!refreshBranches) return;
  await fetchBranches()
}
