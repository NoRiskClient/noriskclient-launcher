<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { quintOut } from "svelte/easing";
  import { scale } from "svelte/transition";

  let microsoftOutput = "Sign in:";

  onMount(async () => {

    const unlisten = await listen("microsoft-output", event => {
      microsoftOutput = event.payload;
    });

    return () => {
      unlisten();
    };
  });

</script>

<h1 class="branch-font" style="position:absolute"
    transition:scale={{ x: 15, duration: 300, easing: quintOut }}>{microsoftOutput}</h1>

<style>
    .branch-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
  }
</style>
