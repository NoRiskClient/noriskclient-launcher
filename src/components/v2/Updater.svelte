<script>
  import { quintOut } from "svelte/easing";
  import { scale } from "svelte/transition";
  import { onMount } from "svelte";
  import { checkUpdate, installUpdate, onUpdaterEvent } from "@tauri-apps/api/updater";
  import { relaunch } from "@tauri-apps/api/process";
  import { isApiOnline, isCheckingForUpdates, noriskLog } from "../../utils/noriskUtils.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import { delay } from "../../utils/svelteUtils.js";
  import { translations } from '../../utils/translationUtils.js';

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  let dots = "";

  onMount(async () => {
    let interval = animateLoadingText();

    const unlisten = await onUpdaterEvent(({ error, status }) => {
      // This will log all updater events, including status updates and errors.
      noriskLog(`Updater event: ${error} ${status}`);
    });

    try {
      const { shouldUpdate, manifest } = await checkUpdate();

      if (shouldUpdate) {
        noriskLog(`Installing update: ${manifest?.version} ${manifest?.body}`);

        // Install the update. This will also restart the app on Windows!
        await installUpdate().catch(reason => {
          addNotification(reason);
        });
        noriskLog(`Update was installed`);

        isCheckingForUpdates.set(false);

        noriskLog(`Trying to relaunch`);

        await relaunch().catch(reason => {
          addNotification(reason);
        });
      } else {
        //TODO das kann in production weg
        await delay(1000);
        isCheckingForUpdates.set(false);
      }
    } catch (error) {
      isCheckingForUpdates.set(false);
      if ($isApiOnline) {
        addNotification(error);
      }
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

{#if lang?.dummy}
  <h1 class="branch-font primary-text" style="position:absolute" transition:scale={{ x: 15, duration: 300, easing: quintOut }}>{lang.updater.searching}{dots}</h1>
{/if}
<style>
    .branch-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        cursor: default;
    }
</style>
