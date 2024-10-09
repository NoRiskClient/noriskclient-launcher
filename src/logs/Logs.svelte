<script>
  import { listen } from "@tauri-apps/api/event";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "../components/log/LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";

  let autoScroll = true;

  let debugDisplay = true;
  let infoDisplay = true;
  let warnDisplay = true;
  let errorDisplay = true;
  let fatalDisplay = true;

  let lastLogLevel = "INFO";
  let searchQuery = "";

  const logStyles = {
    warn: { color: 'orange', textShadow: '1px 1px black' },
    error: { color: 'red', textShadow: '1px 1px black' },
    fatal: { color: 'maroon', textShadow: '1px 1px black' }
  };

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

  function getLogLevel(log) {
    if (log.includes("/DEBUG")) {
      lastLogLevel = "DEBUG";
      return "DEBUG";
    }
    if (log.includes("/WARN")) {
      lastLogLevel = "WARN";
      return "WARN";
    }
    if (log.includes("/ERROR")) {
      lastLogLevel = "ERROR";
      return "ERROR";
    }
    if (log.includes("/FATAL")) {
      lastLogLevel = "FATAL";
      return "FATAL";
    }
    if (log.includes("/INFO")) {
      lastLogLevel = "INFO";
      return "INFO";
    }
    return lastLogLevel;
  }

  $: filteredLogs = $minecraftLogs.filter(log => {
    const level = getLogLevel(log);
    return ((level === "DEBUG" && debugDisplay) ||
            (level === "WARN" && warnDisplay) ||
            (level === "ERROR" && errorDisplay) ||
            (level === "FATAL" && fatalDisplay) ||
            (level === "INFO" && infoDisplay)) &&
           log.toLowerCase().includes(searchQuery.toLowerCase());
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

  function toggleDebugDisplay() {
    autoScroll = false;
    debugDisplay = !debugDisplay;
  }

  function toggleWarnDisplay() {
    autoScroll = false;
    warnDisplay = !warnDisplay;
  }

  function toggleErrorDisplay() {
    autoScroll = false;
    errorDisplay = !errorDisplay;
  }

  function toggleFatalDisplay() {
    autoScroll = false;
    fatalDisplay = !fatalDisplay;
  }

  function toggleInfoDisplay() {
    autoScroll = false;
    infoDisplay = !infoDisplay;
  }

  // Known Issues:
  // Searching while scrolled down might hide results and displays blank
  // Filtering logs while scrolled down might hide results and displays blank

  // Scrolling Up and Down messes up the Coloring for the Follow Up lines for the Levels
</script>


<div class="black-bar" data-tauri-drag-region>
  <input 
    type="text" 
    placeholder="Search logs..." 
    bind:value={searchQuery} 
    class="search-input" 
    on:click={() => autoScroll = false} 
  />
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1
    class:log-filter-on={debugDisplay}
    class:green-text={debugDisplay}
    class:log-filter-off={!debugDisplay}
    class:red-text={!debugDisplay}
    on:click={toggleDebugDisplay}
  >[DEBUG]</h1>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1
    class:log-filter-on={infoDisplay}
    class:green-text={infoDisplay}
    class:log-filter-off={!infoDisplay}
    class:red-text={!infoDisplay}
    on:click={toggleInfoDisplay}
  >[INFO]</h1>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1
    class:log-filter-on={warnDisplay}
    class:green-text={warnDisplay}
    class:log-filter-off={!warnDisplay}
    class:red-text={!warnDisplay}
    on:click={toggleWarnDisplay}
  >[WARN]</h1>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1
    class:log-filter-on={errorDisplay}
    class:green-text={errorDisplay}
    class:log-filter-off={!errorDisplay}
    class:red-text={!errorDisplay}
    on:click={toggleErrorDisplay}
  >[ERROR]</h1>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1
    class:log-filter-on={fatalDisplay}
    class:green-text={fatalDisplay}
    class:log-filter-off={!fatalDisplay}
    class:red-text={!fatalDisplay}
    on:click={toggleFatalDisplay}
  >[FATAL]</h1>
</div>
<main class="content">
  <div class="logs-wrapper">
    <VirtualList items={filteredLogs} let:item {autoScroll}>
      <LogMessage text={item} logStyles={logStyles} logLevel={getLogLevel(item)} />
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

    .log-filter-on {
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: pointer;
    }

    .log-filter-off {
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: pointer;
    }


    .copy-button:hover,
    .auto-scroll-button-on:hover,
    .auto-scroll-button-off:hover {
        transform: scale(1.2);
    }

    .search-input {
        padding: 1em;
        transition: 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        cursor: pointer;
    }
</style>
