<script>
  import { checkUpdate, installUpdate, onUpdaterEvent } from "@tauri-apps/api/updater";
  import { relaunch } from "@tauri-apps/api/process";
  import { onMount } from "svelte";

  console.debug("Starting Update Checker...");
  let dots = "";

  onMount(async () => {

    const unlisten = await onUpdaterEvent(({ error, status }) => {
      // This will log all updater events, including status updates and errors.
      console.log("Updater event", error, status);
    });

    let interval;

    try {
      const { shouldUpdate, manifest } = await checkUpdate();

      if (shouldUpdate) {
        interval = animateLoadingText();
        console.debug(`Installing update ${manifest?.version}, ${manifest?.body}`);

        // Install the update. This will also restart the app on Windows!
        await installUpdate();

        // On macOS and Linux you will need to restart the app manually.
        // You could use this step to display another confirmation dialog.
        await relaunch();
      }
    } catch (error) {
      console.error(error);
    }

    return () => {
      clearInterval(interval);
      unlisten();
    };
  });

  function animateLoadingText() {
    return setInterval(function() {
      dots += " .";
      if (dots.length > 6) {
        dots = "";
      }
    }, 500);
  }
</script>

<div class="black-bar" data-tauri-drag-region=""></div>
<div class="content">
  <h1>Updating Launcher {dots}</h1>
</div>
<div class="black-bar" data-tauri-drag-region=""></div>

<style>
    .black-bar {
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }

    .content {
        background-color: var(--background-color);
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
        gap: 20px;
        padding: 20px; /* Innenabstand für den Schlagschatten */
    }

    .content h1 {
        font-size: 20px;
        font-family: 'Press Start 2P', serif;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }
</style>
