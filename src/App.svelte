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
  import { appWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "./stores/notificationStore.js";

  onMount(async () => {
    setTimeout(async () => {
      await appWindow.show();
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
      if ($location !== "/logs") {
        push("/");
      }
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
    :global(body) {
        --primary-color: #00afe8;
        --secondary-color: #00afe8;
        --primary-color-text-shadow: #094f86;
        --secondary-color-text-shadow: #094f86;
        --hover-color: #e1d1a9;
        --hover-color-text-shadow: #4f4732;
        --background-color: #F8F8F8;
        --background-contrast-color: #e7e7e7;
        --font-color: #161616;
        --font-color-text-shadow: #d0d0d0;
        --font-color-disabled: #858585;
        --dev-font-color: rgb(194, 165, 0);
        --dev-font-color-text-shadow: rgb(170, 144, 0);
        --green-text: #057605;
        --green-text-shadow: #074f07;
        transition: background-color 0.2s;
    }

    :global(body.dark-mode) {
        --primary-color: #00afe8;
        --secondary-color: #6163ff;
        --primary-color-text-shadow: #0d4754;
        --secondary-color-text-shadow: #18193b;
        --hover-color: #f4e4bd;
        --hover-color-text-shadow: #c5a7a7;
        --background-color: #1a191c;
        --background-contrast-color: #222126;
        --font-color: #e8e8e8;
        --font-color-text-shadow: #7a7777;
        --font-color-disabled: #878787;
        --dev-font-color: gold;
        --dev-font-color-text-shadow: rgb(189, 161, 2);
        --green-text: #00ff00;
        --green-text-shadow: #086b08;
    }

    :global(*) {
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }

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
