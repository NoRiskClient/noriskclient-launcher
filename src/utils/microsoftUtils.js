import { invoke } from "@tauri-apps/api/core";
import { fetchDefaultUserOrError } from "../stores/credentialsStore.js";

export function startMicrosoftAuth() {
  invoke("microsoft_auth")
    .then(async result => {
      console.log("Microsoft Auth Result", result)
      await fetchDefaultUserOrError();
    }).catch(async e => {
    await fetchDefaultUserOrError();
    //addNotification(e);
  });
}
