<!-- App.svelte -->
<script>
  import Router from "svelte-spa-router";
  import Home from "./Home.svelte";
  import About from "./About.svelte";
  import Notifications from "../components/notification/Notifications.svelte";
  import MinecraftStartProgress from "./MinecraftStartProgress.svelte";
  import MinecraftClientLogs from "./MinecraftClientLogs.svelte";
  import LauncherSettings from "./LauncherSettings.svelte";
  import Skin from "./Skin.svelte";

  const routes = {
    "/": Home,
    "/about": About,
    "/start-progress": MinecraftStartProgress,
    "/logs": MinecraftClientLogs,
    "/launcher-settings": LauncherSettings,
    "/skin": Skin,
  };
</script>

<div class="black-bar" data-tauri-drag-region>
</div>
<div class="content">
  <Notifications />
  <Router {routes} />
</div>
<div class="black-bar" data-tauri-drag-region></div>

<style>
    .black-bar {
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }

    .content {
        height: 80vh;
    }
</style>
