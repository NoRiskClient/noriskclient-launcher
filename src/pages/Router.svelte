<!-- App.svelte -->
<script>
  import Router, { location } from "svelte-spa-router";
  import { onMount } from "svelte";
  import Home from "./Home.svelte";
  import Notifications from "../components/notification/Notifications.svelte";
  import MinecraftStartProgress from "./MinecraftStartProgress.svelte";
  import MinecraftClientLogs from "./MinecraftClientLogs.svelte";
  import LauncherSettings from "./LauncherSettings.svelte";
  import Capes from "./Capes.svelte";
  import BackButton from "../components/v2/buttons/BackButton.svelte";
  import Profiles from "./Profiles.svelte";
  import Addons from "./Addons.svelte";
  import Mods from "./Mods.svelte";
  import Skin from "./Skin.svelte";
  import Shaders from "./Shaders.svelte";
  import Resourcepacks from "./Resourcepacks.svelte";
  import Datapacks from "./Datapacks.svelte";
  import { isInMaintenanceMode, getMaintenanceMode, isClientRunning, noriskUser } from "../utils/noriskUtils.js";
  import GameButton from "../components/v2/buttons/GameButton.svelte";
  import Crash from "./Crash.svelte";
  import CrashHeader from "../components/v2/CrashHeader.svelte";
  import Servers from "./Servers.svelte";
  import CustomServerDetails from "./CustomServerDetails.svelte";
  import CreateCustomServer from "./CreateCustomServer.svelte";
  import NewBranch from "./NewBranch.svelte";
  import FirstInstall from "./FirstInstall.svelte";
  import CopyMcDataProgress from "./CopyMcDataProgress.svelte";
  import Legal from "./Legal.svelte";
  import MaintenanceMode from "../components/maintenance-mode/MaintenanceModeScreen.svelte";

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
</script>

<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location === "/crash"}
    <CrashHeader />
  {/if}
</div>
<div class="content">
  <Notifications />
  {#if $isInMaintenanceMode == true && !$noriskUser?.isDev}
    <MaintenanceMode />
  {:else if $isInMaintenanceMode == false || $noriskUser?.isDev}
    <Router {routes} />
  {/if}
</div>
<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location !== "/" && $location !== "/logs" && $location !== "/crash" && (!$isInMaintenanceMode || $noriskUser?.isDev)}
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
