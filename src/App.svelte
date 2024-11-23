<script>
  import Router from "./Router.svelte";
  import { onMount } from "svelte";
  import { defaultUser, fetchDefaultUserOrError } from "./stores/credentialsStore.js";
  import { fetchOptions } from "./stores/optionsStore.js";
  import { fetchBranches } from "./stores/branchesStore.js";
  import { fetchProfiles } from "./stores/profilesStore.js";
  import { startMicrosoftAuth } from "./utils/microsoftUtils.js";
  import { listen } from "@tauri-apps/api/event";
  import { push } from "svelte-spa-router";
  import {
    getClientInstances,
    getMaintenanceMode,
    getNoRiskUser,
    getVersion,
    noriskError,
    noriskLog,
  } from "./utils/noriskUtils.js";
  import { getAnnouncements, getChangeLogs, getLastViewedPopups } from "./utils/popupUtils.js";
  import { appWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "./stores/notificationStore.js";
  import { language, setLanguage, translations } from "./utils/translationUtils.js";

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  onMount(async () => {
    setTimeout(async () => {
      await appWindow.show();
    }, 300);
    await getVersion();
    await fetchOptions();
    setLanguage($language);

    await fetchDefaultUserOrError(false);
    const isTokenValid = await getNoRiskUser();
    if (isTokenValid) {
      await fetchBranches();
      await fetchProfiles();
      await getMaintenanceMode();
      await getChangeLogs();
      await getAnnouncements();
      await getLastViewedPopups();
    } else {
      await startMicrosoftAuth();
    }

    const clientInstancesInterval = setInterval(async () => {
      //Hoffe das passt lol
      await getClientInstances();
    }, 2500);

    let unlisten = await listen("client-exited", () => {
      getClientInstances();
      push("/");
    });

    const minecraftCrashUnlisten = await listen("minecraft-crash", async (event) => {
      const crashReportPath = event.payload; // Extract the path from the event's payload
      noriskError("Crash Report Path: " + crashReportPath);
      await invoke("open_minecraft_crash_window", { crashReportPath: crashReportPath })
        .catch(reason => {
          addNotification(reason);
          noriskError(reason);
        });
    });

    const userUnlisten = defaultUser.subscribe(async value => {
      noriskLog("Default User Was Updated.");
      await fetchBranches();
      await fetchProfiles();
      if (!isTokenValid) {
        await getMaintenanceMode();
        await getChangeLogs();
        await getAnnouncements();
        await getLastViewedPopups();
      }
    });

    return () => {
      unlisten();
      minecraftCrashUnlisten();
      userUnlisten();
      clearInterval(clientInstancesInterval);
    };
  });
</script>

<main>
  <!-- Ensure translations are loaded before showing UI -->
  {#if lang?.dummy}
    <Router />
  {/if}
</main>

<style>
</style>
