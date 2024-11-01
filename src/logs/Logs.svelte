<script>
	import { isClientRunning, checkIfClientIsRunning } from './../utils/noriskUtils.js';
  import { listen } from "@tauri-apps/api/event";
  import VirtualList from "../components/utils/VirtualList.svelte";
  import LogMessage from "./LogMessage.svelte";
  import { onMount } from "svelte";
  import { minecraftLogs } from "../stores/logsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";
  import { launcherOptions, fetchOptions } from "../stores/optionsStore.js";

  let autoScroll = true;
  let reloadLogs = false;

  onMount(async () => {
    fetchOptions();
    checkIfClientIsRunning();
    
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

  let search = '';
  let logLevels = {
    DEBUG: false,
    INFO: false,
    WARN: false,
    ERROR: false,
    FATAL: false,
  };
  let hideNoLiveLogs = false;

  function filterLogs(log) {
    const level = log.split('/')[1]?.split(']: ')[0];

    if (level == null) return false;

    return (log.includes(search) || search.trim() === '') && (logLevels[level] || Object.values(logLevels).every(value => value == false));
  }

  $: logItems = search != null && Object.values(logLevels).every(level => level != null) ? $minecraftLogs.filter(filterLogs) : [];
</script>

<body class:dark-mode={$launcherOptions?.theme == "DARK"}>
  <div class="black-bar" data-tauri-drag-region>
    <div class="header">
      <input bind:value={search} placeholder="Search logs" />
      <div class="filter">
        {#each Object.keys(logLevels) as level (level)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <p class={"logLevelFilter red-text"} class:active={logLevels[level] == true} on:click={() => {logLevels[level] = !logLevels[level]; console.log(logLevels)}}>{level}({logItems.filter(l => l.split('/')[1]?.split(']: ')[0] == level).length ?? 0})</p>
        {/each}
      </div>
    </div>
  </div>
  <main class="content">
    {#if $isClientRunning[1] && !hideNoLiveLogs}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div class="noLiveLogs" on:click={() => hideNoLiveLogs = !hideNoLiveLogs}>
        <h1 class="noLiveLogsText">Live logs are unavailable because your launcher was closed since your last game start.</h1>
      </div>
    {/if}
    {#if logItems.length == 0}
      <div class="center">
        {#if !reloadLogs}
          <h1 class="noLogs">No logs found!</h1>
        {/if}
      </div>
    {:else if !reloadLogs}
      <div class="logs-wrapper">
        <VirtualList items={logItems} let:item {autoScroll} disableCustomScrollLogic={true}>
          <LogMessage
            {item}
            log={search.trim() != '' && item.split(']: ').slice(1).join(']: ').includes(search) ? item.split(']: ').slice(1).join(']: ').replaceAll(search, `<span style="background-color: #ff9100;">${search}</span>`) : null}
          />
        </VirtualList>
      </div>
    {/if}
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

    .noLiveLogs {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 60px;
      padding: 10px;
      background-color: #ff5252;
      position: absolute;
      z-index: 100;
    }

    .noLiveLogsText {
      font-family: 'Press Start 2P', serif;
      font-size: 14px;
      color: var(--background-contrast-color);
    }

    .header {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 1em;
        padding: 1em 2em;
    }

    .header input {
      width: 250px;
      height: 30px;
      border: none;
      padding: 0.5em;
      border-radius: 5px;
      color: var(--primary-text);
      background-color: var(--background-color);
    }

    .header input::placeholder {
      color: var(--primary-text);
      opacity: 0.5;
      text-shadow: none;
    }

    .header .filter {
        display: flex;
        flex-direction: row;
        gap: 2em;
        overflow: hidden;
    }

    .header .filter .logLevelFilter {
      font-family: 'Press Start 2P', serif;
      font-size: 13px;
      cursor: pointer;
    }

    .header .filter .logLevelFilter.active {
      color: var(--green-text);
      text-shadow: 2px 2px var(--green-text-shadow);
    }

    .content {
        height: 80vh;
    }

    .content .center {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
    }

    .content .center .noLogs {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
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


    .copy-button:hover,
    .auto-scroll-button-on:hover,
    .auto-scroll-button-off:hover {
        transform: scale(1.2);
    }
</style>
