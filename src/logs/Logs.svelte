<script>
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
      addNotification("Logs uploaded successfully. URL copied to clipboard.", "INFO");
      navigator.clipboard.writeText(result.url);
    }).catch((error) => {
      addNotification(error);
    });
  }

  function toggleAutoScroll() {
    autoScroll = !autoScroll;
  }

  let searchQuery = "";
  let filteredLogs = [];
  let logLevel;
  let logCounts = {};


  let logLevels = {
    debug: false,
    info: false,
    warn: false,
    error: false,
    fatal: false,
  };

  $: {
    minecraftLogs.subscribe(logs => {
      const isAnyLevelSelected = Object.values(logLevels).some(level => level);
      filteredLogs = logs.filter(log => {
        const logMatch = log.match(/\[(.*?)\]/g);
        if (logMatch && logMatch.length > 1) {
          logLevel = logMatch[1].split('/')[1].replace(']', '');
        }
        if (isAnyLevelSelected) {
          return logLevels[logLevel.toLowerCase()] && log.toLowerCase().includes(searchQuery.toLowerCase());
        } else {
          return log.toLowerCase().includes(searchQuery.toLowerCase());
        }
      });
    });
  

    if (searchQuery !== "") {
      autoScroll = false;
    } else {
      autoScroll = true;
    }

    Object.keys(logLevels).forEach(level => {
      logCounts[level] = $minecraftLogs.filter(log => {
        const logMatch = log.match(/\[(.*?)\]/g);
        if (logMatch && logMatch.length > 1) {
          const logLevel = logMatch[1].split('/')[1].replace(']', '');
          return logLevel.toLowerCase() === level;
        }
        return false;
      }).length;
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

<div class="black-bar" data-tauri-drag-region>
  <input class="search-bar" type="text" bind:value={searchQuery} placeholder="Search logs...">
  {#each Object.keys(logLevels) as level (level)}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-label-has-associated-control -->
    <p class="levels" class:loglevel-button-on={logLevels[level]}
      class:green-text={logLevels[level]}
      class:loglevel-button-off={!logLevels[level]}
      class:red-text={!logLevels[level]}
      on:click={() => logLevels[level] = !logLevels[level]}>
      {level} ({logCounts[level]})
    </p>
  {/each}
</div>
<main class="content">
  <div class="logs-wrapper" >
    <VirtualList items={filteredLogs} let:item {autoScroll}>
      <LogMessage text={highlightSearchQuery(item)} />
    </VirtualList>
  </div>
</main>
<div class="black-bar" data-tauri-drag-region>
  <div class="logs-button-wrapper">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1
      class:auto-scroll-button-on={autoScroll}
      class:green-text={autoScroll}
      class:auto-scroll-button-off={!autoScroll}
      class:red-text={!autoScroll}
      on:click={toggleAutoScroll}
    >[Auto Scroll]</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="copy-button primary-text" on:click={uploadLogs}>
      [Copy]
    </h1>
  </div>
</div>

<style>
  .search-bar {
    margin-right: 20px;
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
      overflow-y: auto; 
      overflow-x: auto;
      max-height: 80vh;
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
      cursor: pointer;
  }

  .auto-scroll-button-on {
      transition: 0.3s;
      font-family: 'Press Start 2P', serif;
      font-size: 17px;
      cursor: pointer;
  }

  .auto-scroll-button-off {
      transition: 0.3s;
      font-family: 'Press Start 2P', serif;
      font-size: 17px;
      cursor: pointer;
  }

  .loglevel-button-on {
      transition: 0.2s;
      font-family: 'Press Start 2P', serif;
      font-size: 11px;
      cursor: pointer;
  }

  .loglevel-button-off {
      transition: 0.2s;
      font-family: 'Press Start 2P', serif;
      font-size: 11px;
      cursor: pointer;
  }

  .copy-button:hover,
  .auto-scroll-button-on:hover,
  .auto-scroll-button-off:hover {
      transform: scale(1.2);
  }
</style>
