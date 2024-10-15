<!-- App.svelte -->
<script>
	import Announcement from './pages/Announcement.svelte';
	import ChangeLog from './pages/ChangeLog.svelte';
	import { setStillRunningCustomServer } from './stores/customServerLogsStore.js';
  import Router, { location } from "svelte-spa-router";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { isInMaintenanceMode, isClientRunning, noriskUser, checkApiStatus, noriskError } from "./utils/noriskUtils.js";
  import { addNotification } from "./stores/notificationStore.js";
  import { activePopup } from "./utils/popupUtils.js";
  import Home from "./pages/Home.svelte";
  import Notifications from "./components/notification/Notifications.svelte";
  import MinecraftStartProgress from "./pages/MinecraftStartProgress.svelte";
  import LauncherSettings from "./pages/LauncherSettings.svelte";
  import Capes from "./pages/Capes.svelte";
  import BackButton from "./components/v2/buttons/BackButton.svelte";
  import Profiles from "./pages/Profiles.svelte";
  import Addons from "./pages/Addons.svelte";
  import Mods from "./pages/Mods.svelte";
  import Skin from "./pages/Skin.svelte";
  import Shaders from "./pages/Shaders.svelte";
  import Resourcepacks from "./pages/Resourcepacks.svelte";
  import Datapacks from "./pages/Datapacks.svelte";
  import GameButton from "./components/v2/buttons/GameButton.svelte";
  import Servers from "./pages/Servers.svelte";
  import CustomServerDetails from "./pages/CustomServerDetails.svelte";
  import CreateCustomServer from "./pages/CreateCustomServer.svelte";
  import NewBranch from "./pages/NewBranch.svelte";
  import FirstInstall from "./pages/FirstInstall.svelte";
  import CopyMcDataProgress from "./pages/CopyMcDataProgress.svelte";
  import Legal from "./pages/Legal.svelte";
  import MaintenanceMode from "./components/maintenance-mode/MaintenanceModeScreen.svelte";
  import ApiOfflineScreen from "./components/maintenance-mode/ApiOfflineScreen.svelte";
  import { listen } from "@tauri-apps/api/event";
  import LaunchErrorModal from "./components/home/widgets/LaunchErrorModal.svelte";
  import Popup from "./components/utils/Popup.svelte";

  const routes = {
    "/": Home,
    "/changeLog": ChangeLog,
    "/announcement": Announcement,
    "/legal": Legal,
    "/first-install": FirstInstall,
    "/new-branch": NewBranch,
    "/copy-mc-data-progress": CopyMcDataProgress,
    "/start-progress": MinecraftStartProgress,
    "/launcher-settings": LauncherSettings,
    "/capes": Capes,
    "/profiles": Profiles,
    "/skin": Skin,
    "/servers": Servers,
    "/servers/custom/create": CreateCustomServer,
    "/servers/custom/details": CustomServerDetails,
    "/addons": Addons,
    "/addons/mods": Mods,
    "/addons/resourcepacks": Resourcepacks,
    "/addons/datapacks": Datapacks,
    "/addons/shaders": Shaders,
  };

  let apiIsOnline = null;
  let showLaunchErrorModal = false;
  let launchErrorReason;

  onMount(async () => {
    apiIsOnline = await checkApiStatus();

    const clientLaunchError = await listen("client-error", async (event) => {
      let reason = event.payload; // Extract the path from the event's payload
      // Remove the prefix "Failed to launch client:" if it exists
      if (reason.startsWith("Failed to launch client: ")) {
        reason = reason.replace("Failed to launch client: ", "");
      }
      noriskError(reason);
      showLaunchErrorModal = true;
      launchErrorReason = reason
    });

    invoke("check_if_custom_server_running").then((value) => {
      console.log(value);
      if (value[0] == true) {
        setStillRunningCustomServer(value[1]);
      }
    }).catch(error => addNotification("Failed to check if custom server is running: " + error));

    return () => {
      clientLaunchError();
    };
  });

  // Event Handler
  function handleRouteEvent(event) {
    console.log('Route Event:', event.detail);
  }

  function handleConditionsFailed(event) {
    console.log('Conditions Failed:', event.detail);
  }

  function handleRouteLoading(event) {
    console.log('Route Loading:', event.detail);
  }

  function handleRouteLoaded(event) {
    //wir delayen es weil mein gehirn ein delay hat ganz groß
    setTimeout(() => {
      const elements = document.querySelectorAll('#transition-wrapper');
      //Yep ihr seht richtig anstatt das problem an der wurzel zu bekämpfen mache ich ihn hier
      //aber es ballert so böse ich weiß nicht warum es passiert und deswegen jo
      //und ja das window moved trotzdem noch bisschen aber wird dann gecleared....
      //alter alter
      console.log("Elements: ", elements)
      if (elements.length > 1) {
        let element = elements[0]
        const inlineStyles = element.getAttribute('style');
        //if (inlineStyles.includes("animation: 300ms linear 0ms 1 normal both running")) {
        elements[0].remove()
        //}
      }
      console.log('Route Loaded:', event.detail);
    },300)
  }
</script>

<div class="black-bar" data-tauri-drag-region></div>
<div class="content">
  {#if showLaunchErrorModal}
    <LaunchErrorModal bind:showModal={showLaunchErrorModal} bind:reason={launchErrorReason}/>
  {/if}
  {#if apiIsOnline === false}
    <ApiOfflineScreen />
  {:else if apiIsOnline === true}
    <Notifications />
    {#if $activePopup != null}
      <Popup />
    {/if}
    {#if $isInMaintenanceMode === true && !$noriskUser?.isDev}
      <MaintenanceMode />
    {:else if $isInMaintenanceMode === false || $noriskUser?.isDev}
      <Router {routes}
              on:routeEvent={handleRouteEvent}
              on:conditionsFailed={handleConditionsFailed}
              on:routeLoading={handleRouteLoading}
              on:routeLoaded={handleRouteLoaded}
      />
    {/if}
  {/if}
</div>
<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location !== "/" && $location !== "/announcement" && (!$isInMaintenanceMode || $noriskUser?.isDev) && apiIsOnline === true}
    <BackButton />
  {:else if $isClientRunning[0]}
    <GameButton />
  {/if}
</div>

<style>
    .black-bar {
        display: flex;
        align-content: center;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }

    .content {
        height: 80vh;
    }
</style>
