import { invoke } from "@tauri-apps/api";
import { fetchDefaultUserOrError } from "../stores/credentialsStore.js";
import { noriskLog } from "./noriskUtils.js";

export function startMicrosoftAuth() {
  invoke("microsoft_auth")
    .then(async result => {
      noriskLog("Microsoft Auth Result: " + JSON.stringify(result));
      await fetchDefaultUserOrError();
    }).catch(async () => {
      await fetchDefaultUserOrError();
    });
}
