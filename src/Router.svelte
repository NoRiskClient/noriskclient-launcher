<!-- App.svelte -->
<script>
  import Router, { location } from "svelte-spa-router";
  import { onMount } from "svelte";
  import { isInMaintenanceMode, isClientRunning, noriskUser, checkApiStatus } from "./utils/noriskUtils.js";
  import Home from "./pages/Home.svelte";
  import Notifications from "./components/notification/Notifications.svelte";
  import MinecraftStartProgress from "./pages/MinecraftStartProgress.svelte";
  import MinecraftClientLogs from "./pages/MinecraftClientLogs.svelte";
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
  import Crash from "./pages/Crash.svelte";
  import CrashHeader from "./components/v2/CrashHeader.svelte";
  import Servers from "./pages/Servers.svelte";
  import CustomServerDetails from "./pages/CustomServerDetails.svelte";
  import CreateCustomServer from "./pages/CreateCustomServer.svelte";
  import NewBranch from "./pages/NewBranch.svelte";
  import FirstInstall from "./pages/FirstInstall.svelte";
  import CopyMcDataProgress from "./pages/CopyMcDataProgress.svelte";
  import Legal from "./pages/Legal.svelte";
  import MaintenanceMode from "./components/maintenance-mode/MaintenanceModeScreen.svelte";
  import ApiOfflineScreen from "./components/maintenance-mode/ApiOfflineScreen.svelte";

  const routes = {
    "/": Home,
    "/legal": Legal,
    "/first-install": FirstInstall,
    "/new-branch": NewBranch,
    "/copy-mc-data-progress": CopyMcDataProgress,
    "/start-progress": MinecraftStartProgress,
    "/logs": MinecraftClientLogs,
    "/crash": Crash,
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

  onMount(async () => {
    apiIsOnline = await checkApiStatus();
    
  });
</script>

<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location === "/crash"}
    <CrashHeader />
  {/if}
</div>
<div class="content">
  {#if apiIsOnline == false}
  <ApiOfflineScreen />
  {:else if apiIsOnline == true}
    <Notifications />
    {#if $isInMaintenanceMode == true && !$noriskUser?.isDev}
      <MaintenanceMode />
    {:else if $isInMaintenanceMode == false || $noriskUser?.isDev}
      <Router {routes} />
    {/if}
  {/if}
</div>
<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location !== "/" && $location !== "/logs" && $location !== "/crash" && (!$isInMaintenanceMode || $noriskUser?.isDev) && apiIsOnline == true}
    <BackButton />
  {:else}
    {#if $isClientRunning}
      <GameButton />
    {/if}
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
