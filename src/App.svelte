<script>
  import Router from "./Router.svelte";
  import { onMount } from "svelte";
  import { defaultUser, fetchDefaultUserOrError } from "./stores/credentialsStore.js";
  import { fetchOptions } from "./stores/optionsStore.js";
  import { fetchBranches } from "./stores/branchesStore.js";
  import { fetchProfiles } from "./stores/profilesStore.js";
  import { listen } from "@tauri-apps/api/event";
  import { location, push } from "svelte-spa-router";
  import { isClientRunning, startProgress, getNoRiskUser, getMaintenanceMode, noriskLog } from "./utils/noriskUtils.js";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { invoke } from "@tauri-apps/api/core";
  import { addNotification } from "./stores/notificationStore.js";

  onMount(async () => {
    setTimeout(async () => {
      await getCurrentWebviewWindow().show();
    }, 300);
    await fetchOptions();
    await fetchDefaultUserOrError(false);
    await getNoRiskUser();
    await fetchBranches();
    await fetchProfiles();
    await getMaintenanceMode();

    let unlisten = await listen("client-exited", () => {
      isClientRunning.set(false);
      startProgress.set({
        progressBarMax: 0,
        progressBarProgress: 0,
        progressBarLabel: "",
      });
      push("/");
    });

    const errorUnlisten = await listen("client-error", async (e) => {
      await invoke("open_minecraft_crash_window").catch(reason => {
        addNotification(reason);
      });
    });

    const userUnlisten = defaultUser.subscribe(async value => {
      noriskLog("Default User Was Updated.");
      await fetchBranches();
      await fetchProfiles();
    });

    return () => {
      unlisten();
      errorUnlisten();
      userUnlisten();
    };
  });
</script>

<main>
  <Router />
</main>

<style>
    :global(.red-text) {
        color: red;
        text-shadow: 2px 2px #460000;
    }

    :global(.red-text-clickable) {
        color: red;
        text-shadow: 2px 2px #460000;
        cursor: pointer;
    }

    :global(.primary-text) {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    :global(.green-text) {
        color: var(--green-text);
        text-shadow: 2px 2px var(--green-text-shadow);
    }
</style>
