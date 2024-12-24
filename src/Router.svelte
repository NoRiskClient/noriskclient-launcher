<!-- App.svelte -->
<script>
	import SnowOverlay from './components/utils/SnowOverlay.svelte';
  import Announcement from "./pages/Announcement.svelte";
  import ChangeLog from "./pages/ChangeLog.svelte";
  import { setStillRunningCustomServer } from "./stores/customServerLogsStore.js";
  import Router, { location, push } from "svelte-spa-router";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { setLanguage, language, translations } from "./utils/translationUtils.js";
  import { isInMaintenanceMode, noriskError, noriskUser, isApiOnline, isWinterSeason } from "./utils/noriskUtils.js";
  import { addNotification } from "./stores/notificationStore.js";
  import { activePopup, openConfirmPopup } from "./utils/popupUtils.js";
  import { appWindow } from "@tauri-apps/api/window";
  import Home from "./pages/Home.svelte";
  import Notifications from "./components/notification/Notifications.svelte";
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
  import Servers from "./pages/Servers.svelte";
  import CustomServerDetails from "./pages/CustomServerDetails.svelte";
  import CreateCustomServer from "./pages/CreateCustomServer.svelte";
  import NewBranch from "./pages/NewBranch.svelte";
  import FirstInstall from "./pages/FirstInstall.svelte";
  import CopyMcDataProgress from "./pages/CopyMcDataProgress.svelte";
  import Legal from "./pages/Legal.svelte";
  import InstanceProgress from "./components/instances/InstanceProgress.svelte";
  import MaintenanceMode from "./components/maintenance-mode/MaintenanceModeScreen.svelte";
  import { listen } from "@tauri-apps/api/event";
  import LaunchErrorModal from "./components/home/widgets/LaunchErrorModal.svelte";
  import Popup from "./components/utils/Popup.svelte";
  import InstancesHotbar from "./components/instances/InstancesHotbar.svelte";

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  const routes = {
    "/": Home,
    "/changeLog": ChangeLog,
    "/announcement": Announcement,
    "/legal": Legal,
    "/first-install": FirstInstall,
    "/new-branch": NewBranch,
    "/copy-mc-data-progress": CopyMcDataProgress,
    "/start-progress/:id": InstanceProgress,
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

  let showLaunchErrorModal = false;
  let launchErrorReason;

  onMount(async () => {
    invoke("check_privacy_policy").then(value => {
      if (value) return;
      openPrivacyPolicyPopup();
    }).catch(error => {
      noriskError("Failed to check privacy policy: " + error);
      appWindow.close();
    });

    const clientLaunchError = await listen("client-error", async (event) => {
      let reason = event.payload; // Extract the path from the event's payload
      // Remove the prefix "Failed to launch client:" if it exists
      if (reason.startsWith("Failed to launch client: ")) {
        reason = reason.replace("Failed to launch client: ", "");
      }
      noriskError(reason);
      showLaunchErrorModal = true;
      launchErrorReason = reason;
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
    console.log("Route Event:", event.detail);
  }

  function handleConditionsFailed(event) {
    console.log("Conditions Failed:", event.detail);
  }

  function handleRouteLoading(event) {
    console.log("Route Loading:", event.detail);
  }

  function handleRouteLoaded(event) {
    //wir delayen es weil mein gehirn ein delay hat ganz groß
    setTimeout(() => {
      const elements = document.querySelectorAll("#transition-wrapper");
      //Yep ihr seht richtig anstatt das problem an der wurzel zu bekämpfen mache ich ihn hier
      //aber es ballert so böse ich weiß nicht warum es passiert und deswegen jo
      //und ja das window moved trotzdem noch bisschen aber wird dann gecleared....
      //alter alter
      console.log("Elements: ", elements);
      if (elements.length > 1) {
        let element = elements[0];
        const inlineStyles = element.getAttribute("style");
        //if (inlineStyles.includes("animation: 300ms linear 0ms 1 normal both running")) {
        elements[0].remove();
        //}
      }
      console.log("Route Loaded:", event.detail);
    }, 300);
  }

  function openPrivacyPolicyPopup() {
    openConfirmPopup({
        title: lang.privacyPolicy.title,
        content: lang.privacyPolicy.text,
        confirmButton: lang.privacyPolicy.button.accept,
        cancelButton: lang.privacyPolicy.button.exit,
        allowEscape: false,
        onConfirm: acceptPrivacyPolicy,
        onCancel: () => appWindow.close(),
        width: "35",
        height: "25"
      });
  }

  async function acceptPrivacyPolicy() {
    await invoke("accept_privacy_policy").then(async () => {
      await invoke("check_privacy_policy").then(value => {
        if (!value) {
          addNotification("Failed to accept privacy policy!");
          openPrivacyPolicyPopup();
          return;
        }
      });
    }).catch(error => {
      addNotification(error);
      openPrivacyPolicyPopup();
    });
    }
</script>

<div class="black-bar" data-tauri-drag-region>
  {#if $isApiOnline === false}
    <h1 class="offline-button red-text-clickable">OFFLINE</h1>
  {/if}
</div>
<div class="snow">
  {#if isWinterSeason}
    <SnowOverlay/>
  {/if}
</div>
<div class="content">
  <LaunchErrorModal bind:showModal={showLaunchErrorModal} bind:reason={launchErrorReason} />
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
</div>
<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location !== "/" && $location !== "/privacy-policy" && $location !== "/announcement" && (!$isInMaintenanceMode || $noriskUser?.isDev)}
    <BackButton />
  {:else if $location == "/privacy-policy"}
    <div class="lang-switcher">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <p class:active={$language == "de_DE"} on:click={() => setLanguage("de_DE")}>[Deutsch]</p>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <p class:active={$language == "en_US"} on:click={() => setLanguage("en_US")}>[English]</p>
    </div>
  {:else}
    <InstancesHotbar />
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

    .offline-button {
        transition: transform 0.3s;
        position: absolute;
        font-size: 20px;
        text-shadow: 2px 2px #7a7777;
            cursor: pointer;
    }

    .offline-button:hover {
        transform: scale(1.2);
    }

    .lang-switcher {
      display: flex;
      flex-direction: row;
    }

    .lang-switcher p {
      font-size: 15px;
      margin-left: 1em;
      margin-right: 1em;
      cursor: pointer;
      transition-duration: 300ms;
    }

    .lang-switcher p:hover {
      transform: scale(1.2);
    }

    .lang-switcher p.active {
      color: var(--primary-color);
      text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .snow {
      position: absolute;
      height: 80vh;
      width: 100%;
      z-index: 2;
    }

    .content {
      position: relative;
      height: 80vh;
      z-index: 10;
    }
</style>
