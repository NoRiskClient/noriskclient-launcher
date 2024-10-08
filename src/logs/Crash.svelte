<script>
  import { listen } from "@tauri-apps/api/event";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "../components/log/LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";
  import { noriskError } from "../utils/noriskUtils.js";

  onMount(async () => {
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

  let searchQuery = "";
  let filteredLogs = [];

  $: {
    minecraftLogs.subscribe(logs => {
      filteredLogs = logs.filter(log => {
          return log.toLowerCase().includes(searchQuery.toLowerCase());
      });
    });
  }

  function highlightSearchQuery(text) {
    if (searchQuery === "") {
      return text;
    }
    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return parts.map(part => part.toLowerCase() === searchQuery.toLowerCase() ? `<span style="background-color:yellow;">${part}</span>` : part).join('');
  }

</script>



<div class="black-bar-top" data-tauri-drag-region>
  <h1 class="back-button">CRASHED :(</h1>
  <input class="search-bar" type="text" bind:value={searchQuery} placeholder="Search logs...">
</div>
<main class="content">
  <div class="logs-wrapper">
    <div class="logs-wrapper" >
      <VirtualList items={filteredLogs} let:item>
        <LogMessage text={highlightSearchQuery(item)} />
      </VirtualList>
    </div>
  </div>
</main>
<div class="black-bar-bottom" data-tauri-drag-region>
  <div class="logs-button-wrapper">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="copy-button" on:click={uploadLogs}>
      [Copy]
    </h1>
  </div>
</div>

<style>
   .search-bar {
    margin-left: 10px; /* Abstand von 10px zum linken Rand */
    padding: 10px;
    border: 3px solid #ccc;
    border-radius: 0; 
    outline: none;
    box-shadow: 0 0 10px rgba(0,0,0,0.2);
  }
  .levels {
    margin-right: 18px;
  }

  .search-bar {
    margin-right: 20px;
  }
  .black-bar-top {
      display: flex;
      align-content: center;
      align-items: center;
      width: 100%;
      height: 10vh;
      background-color: #151515;
  }

  .black-bar-bottom {
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
    font-size: 20px;
    color: #e8e8e8;
    text-shadow: 2px 2px #7a7777;
    font-family: 'Press Start 2P', serif;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
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
