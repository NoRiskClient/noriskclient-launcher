import { invoke } from "@tauri-apps/api";
import { fetchDefaultUserOrError } from "../stores/credentialsStore.js";
import { noriskLog } from "./noriskUtils.js";

export function startMicrosoftAuth() {
  invoke("microsoft_auth")
    .then(async result => {
      result.access_token = '********';
      result.refresh_token = '********';
      if (result.norisk_credentials.production) {
        result.norisk_credentials.production.value = '********';
      }
      if (result.norisk_credentials.experimental) {
        result.norisk_credentials.experimental.value = '********';
      }
      noriskLog("Microsoft Auth Result: " + JSON.stringify(result));
      await fetchDefaultUserOrError();
    }).catch(async () => {
      await fetchDefaultUserOrError();
    });
}
