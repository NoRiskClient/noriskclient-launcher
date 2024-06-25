<script>
  import TransitionWrapper2 from "./TransitionWrapper2.svelte";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "../components/log/LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";

  let autoScroll = true;

  onMount(() => {
    invoke("get_latest_minecraft_logs").then(value => {
      minecraftLogs.set(value.map(string => string + "\n"));
    }).catch(reason => {
      addNotification(reason);
    });
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
</script>

<TransitionWrapper2>
  <div class="logs-wrapper">
    <VirtualList items={$minecraftLogs} let:item {autoScroll}>
      <LogMessage text={item} />
    </VirtualList>
    <div class="logs-button-wrapper">
      <h1 class="copy-button" on:click={uploadLogs}>
        [Copy]
      </h1>
    </div>
  </div>
</TransitionWrapper2>


<style>
    .logs-wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .logs-button-wrapper {
        display: flex;
        justify-content: center;
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

    .copy-button:hover {
        transform: scale(1.2);
    }
</style>
