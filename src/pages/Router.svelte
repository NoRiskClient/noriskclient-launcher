<!-- App.svelte -->
<script>
  import Router, { location } from "svelte-spa-router";
  import Home from "./Home.svelte";
  import About from "./About.svelte";
  import Notifications from "../components/notification/Notifications.svelte";
  import MinecraftStartProgress from "./MinecraftStartProgress.svelte";
  import MinecraftClientLogs from "./MinecraftClientLogs.svelte";
  import LauncherSettings from "./LauncherSettings.svelte";
  import Capes from "./Capes.svelte";
  import BackButton from "../components/v2/buttons/BackButton.svelte";
  import Profiles from "./Profiles.svelte";
  import Addons from "./Addons.svelte";
  import Mods from "./Mods.svelte";
  import Shaders from "./Shaders.svelte";
  import Resourcepacks from "./Resourcepacks.svelte";
  import Datapacks from "./Datapacks.svelte";
  import { isClientRunning } from "../utils/noriskUtils.js";
  import GameButton from "../components/v2/buttons/GameButton.svelte";

  const routes = {
    "/": Home,
    "/about": About,
    "/start-progress": MinecraftStartProgress,
    "/logs": MinecraftClientLogs,
    "/launcher-settings": LauncherSettings,
    "/capes": Capes,
    "/profiles": Profiles,
    "/addons": Addons,
    "/addons/mods": Mods,
    "/addons/resourcepacks": Resourcepacks,
    "/addons/datapacks": Datapacks,
    "/addons/shaders": Shaders,
  };
</script>

<div class="black-bar" data-tauri-drag-region>
</div>
<div class="content">
  <Notifications />
  <Router {routes} />
</div>
<div class="black-bar" data-tauri-drag-region>
  <!-- Bisschen unschön wenn man da in Zukunft noch mehr machen will... aber das ist ein Problem für die Zukunft YOOYOYOYOYOYOJOJOJO-->
  {#if $location !== "/" && $location !== "/logs"}
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
