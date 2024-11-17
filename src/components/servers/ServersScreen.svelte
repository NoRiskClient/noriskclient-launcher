<script>
  import { invoke } from "@tauri-apps/api";
  import { push } from "svelte-spa-router";
  import VirtualList from "../utils/VirtualList.svelte";
  import FeaturedServerItem from "./featured/FeaturedServerItem.svelte";
  import CustomServerItem from "./custom/CustomServerItem.svelte";
  import { createEventDispatcher } from "svelte";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { featureWhitelist, noriskLog } from "../../utils/noriskUtils.js";
  import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { customServers, clearCustomServers, addCustomServer, setCustomServerBaseDomain, setActiveCustomServerId } from "../../stores/customServerStore.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import { translations } from '../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  const dispatch = createEventDispatcher();

  let featuredServers = [];
  let customServerLimit = 0;
  let currentTabIndex = 0;

  async function loadData() {
    featuredServers = null;
    clearCustomServers();

    await invoke("get_featured_servers", { branch: $branches[$currentBranchIndex] }).then((result) => {
      featuredServers = result;
    }).catch((error) => {
      featuredServers = [];
      addNotification("Failed to load featured servers: " + error);
    });

    if ($featureWhitelist.includes("CUSTOM_SERVERS")) {
      await invoke("get_custom_servers", {
        token: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id,
      }).then((result) => {
        noriskLog("Loaded custom servers: " + JSON.stringify(result));
        result.servers.forEach((server) => addCustomServer(server));
        customServerLimit = result.limit;
        setCustomServerBaseDomain(result.baseUrl);
      }).catch((error) => {
        clearCustomServers();
        addNotification("Failed to load custom servers: " + error);
      });
    }
  }

  loadData();
</script>


<div class="servers-wrapper">
  {#if $featureWhitelist.includes("CUSTOM_SERVERS")}
    <div class="navbar">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class:primary-text={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>{lang.servers.button.featured}</h1>
      <h2>|</h2>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class:primary-text={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>{lang.servers.button.custom}</h1>
    </div>
  {:else}
    <div class="navbar">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1>{lang.servers.navbar.featuredServers}</h1>
    </div>
  {/if}
  {#if currentTabIndex === 0}
    {#if featuredServers !== null && featuredServers.length > 0 }
      <div class="serverList">
        <VirtualList height="30em" items={featuredServers} let:item>
          <FeaturedServerItem on:play={() => dispatch("play")} server={item} />
        </VirtualList>
      </div>
    {:else}
      <h1 class="loading-indicator">{featuredServers != null ? lang.servers.featured.empty : lang.servers.loading}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <div class="customServerToolbar">
      <h4>Servers: {$customServers?.length ?? 0} / {customServerLimit == -1 ? '∞' : customServerLimit ?? 0}</h4>
      {#if customServerLimit == -1 || $customServers?.length < customServerLimit}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h4 class="create-server-button green-text" on:click={() => push("/servers/custom/create")}>{lang.servers.button.createCustomServer}</h4>
      {:else}
        <h4 class="create-server-button-limit" title={lang.servers.tooltip.customServerLimit}>{lang.servers.custom.limitReached}</h4>
      {/if}
    </div>
    {#if customServers !== null && $customServers.length > 0}
      <div class="serverList">
        <VirtualList height="30em" items={$customServers} let:item>
          <CustomServerItem on:openDetails={() => setActiveCustomServerId(item._id)} server={item} />
        </VirtualList>
      </div>
    {:else}
      <h1
        class="loading-indicator">{$customServers.length == 0 ? lang.servers.custom.empty : lang.servers.loading}</h1>
    {/if}
  {/if}
</div>

<style>
  .servers-wrapper {
      width: 100%;
      height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      gap: 0.7em;
    }

    .navbar {
        display: flex;
        margin-top: 2em;
        justify-content: center;
    }

    .navbar h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .navbar h1:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
        transform: scale(1.05);
    }

    .navbar h2 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0 2em 0.8em 2em;
        cursor: default;
    }

    .loading-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-top: 200px;
    }

    .customServerToolbar {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding-left: 1em;
        padding-right: 1em;
        height: 40px;
    }

    .customServerToolbar h4 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
    }

    .create-server-button {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .create-server-button:hover {
        transform: scale(1.2);
    }

    .create-server-button-limit {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: red;
        text-shadow: 1px 1px #8b0000;
    }

    .serverList {
        display: flex;
        flex-direction: column;
        padding-left: 1em;
        padding-right: 1em;
    }
</style>
