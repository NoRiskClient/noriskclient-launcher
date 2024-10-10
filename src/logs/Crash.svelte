<script>
  import { listen } from "@tauri-apps/api/event";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "./LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";
  import { noriskError } from "../utils/noriskUtils.js";
  import { launcherOptions, fetchOptions } from "../stores/optionsStore.js";

  onMount(async () => {
    fetchOptions();

    const crashReportUnlisten = await listen("crash-report", async (event) => {
      const crashReportPath = event.payload;
      try {
        const crashLogs = await invoke("read_txt_file", { filePath: crashReportPath });
        minecraftLogs.set(crashLogs.map(line => line + "\n"));
      } catch (error) {
        addNotification(error);
        noriskError(error)
      }
    });
    return () => {
      crashReportUnlisten();
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
</script>


<body class:dark-mode={$launcherOptions?.theme == "DARK"}>
  <div class="black-bar" data-tauri-drag-region>
    <h1 class="back-button">CRASHED :(</h1>
  </div>
  <main class="content">
    <div class="logs-wrapper">
      <VirtualList items={$minecraftLogs} let:item>
        <LogMessage item={item} />
      </VirtualList>
    </div>
  </main>
  <div class="black-bar" data-tauri-drag-region>
    <div class="logs-button-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="copy-button" on:click={uploadLogs}>
        [Copy]
      </h1>
    </div>
  </div>
</body>

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

    .logs-wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .back-button {
        transition: transform 0.3s;
        position: absolute;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
    }

    .back-button:hover {
        transform: scale(1.2);
    }

    .logs-button-wrapper {
        display: flex;
        justify-content: space-between;
        padding: 1em;
        gap: 2em;
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
