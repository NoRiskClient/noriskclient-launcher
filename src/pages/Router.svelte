<!-- App.svelte -->
<script>
  import Router from "svelte-spa-router";
  import Home from "./Home.svelte";
  import About from "./About.svelte";
  import Notifications from "../components/notification/Notifications.svelte";

  const routes = {
    "/": Home,
    "/about": About,
  };
</script>

<div class="black-bar" data-tauri-drag-region>
  <a href="/">Home</a>
  <a href="/#/about">About</a>
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
