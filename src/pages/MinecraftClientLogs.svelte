<script>
  import PopuotWindowTransitionWrapper from "./PopuotWindowTransitionWrapper.svelte";
  import { listen } from "@tauri-apps/api/event";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "../components/log/LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";

  let autoScroll = true;

  onMount(async () => {
    invoke("get_latest_minecraft_logs").then(value => {
      minecraftLogs.set(value.map(string => string + "\n"));
    }).catch(reason => {
      addNotification(reason);
    });

    const logsUnlisten = await listen("process-output", event => {
      minecraftLogs.update(value => {
        return [...value, event.payload];
      });
    });
    return () => {
      logsUnlisten();
    };
  });

  async function uploadLogs() {
    await invoke("upload_logs", {
      log: $minecraftLogs.join(""),
    }).then((result) => {
      console.debug("Received Result", result);
      navigator.clipboard.writeText(result.url);
    }).catch((error) => {
      addNotification(error);
    });
  }

  function toggleAutoScroll() {
    autoScroll = !autoScroll;
  }
</script>

<PopuotWindowTransitionWrapper>
  <div class="logs-wrapper">
    <VirtualList items={$minecraftLogs} let:item {autoScroll}>
      <LogMessage text={item} />
    </VirtualList>
    <div class="logs-button-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class:auto-scroll-button-on={autoScroll} class:auto-scroll-button-off={!autoScroll}
          on:click={toggleAutoScroll}>
        [Auto Scroll]
      </h1>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="copy-button" on:click={uploadLogs}>
        [Copy]
      </h1>
    </div>
  </div>
</PopuotWindowTransitionWrapper>


<style>
    .logs-wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .logs-button-wrapper {
        display: flex;
        justify-content: space-between;
        padding: 1em;
    }

    .copy-button {
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: pointer;
    }

    .auto-scroll-button-on {
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
        cursor: pointer;
    }

    .auto-scroll-button-off {
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: red;
        text-shadow: 2px 2px #460000;
        cursor: pointer;
    }


    .copy-button:hover,
    .auto-scroll-button-on:hover,
    .auto-scroll-button-off:hover {
        transform: scale(1.2);
    }
</style>
