<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import CapeCarousel from "./CapeCarousel.svelte";
  import CapeEditor from "./CapeEditor.svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { preventSelection } from "../../utils/svelteUtils.js";

  let capes = null;
  let capeHash = null;
  let isLoading = true;
  let requests = [
    { text: "CAPE EDIT" },
    { text: "ALLTIME" },
    { text: "WEEKLY" },
    { text: "OWNED" },
  ];
  let currentRequest = 0;

  async function requestTrendingCapes(alltime) {
    if ($defaultUser) {
      await invoke("request_trending_capes", {
        noriskToken: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id,
        alltime: alltime,
        limit: 30,
      }).then((result) => {
        console.log("Requesting Trending capes", result);
        capes = result;
      }).catch(e => {
        console.error(e);
      });
    }
  }

  async function requestOwnedCapes() {
    if ($defaultUser) {
      await invoke("request_owned_capes", {
        noriskToken: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id,
        limit: 30,
      }).then((result) => {
        console.debug("Requesting owned capes", result);
        capes = result;
      }).catch(e => {
        console.error(e);
      });
    }
  }

  async function switchTab(tab) {
    currentRequest = tab;
    capes = null;
    if (currentRequest === 1) {
      await requestTrendingCapes(1);
    } else if (currentRequest === 2) {
      await requestTrendingCapes(0);
    } else if (currentRequest === 3) {
      await requestOwnedCapes();
    }
  }

  async function getNoRiskUserByUUID() {
    if ($defaultUser) {
      await invoke("get_cape_hash_by_uuid", {
        uuid: $defaultUser.id,
      }).then((user) => {
        if (user) {
          capeHash = user;
        } else {
          console.log("No Cape Found");
        }
        isLoading = false;
      }).catch(e => {
        alert("Failed to Request User by UUID: " + e);
        console.error(e);
        isLoading = false;
      });
    }
  }

  getNoRiskUserByUUID();
</script>

<div class="wrapper">
  <div class="tab-wrapper">
    <h1 on:click={() => switchTab(0)} class:active-tab={currentRequest === 0}>EDITOR</h1>
    <div class="button-wrapper">
      <h2 on:click={() => switchTab(1)} class:active-tab={currentRequest === 1}>ALL TIME</h2>
      <h2 on:click={() => switchTab(2)} class:active-tab={currentRequest === 2}>WEEKLY</h2>
      <h2 on:click={() => switchTab(3)} class:active-tab={currentRequest === 3}>OWNED</h2>
    </div>
  </div>
  <div class="cape-wrapper">
    {#if currentRequest === 0}
      {#if !isLoading}
        <CapeEditor on:fetchNoRiskUser={getNoRiskUserByUUID} bind:capeHash />
      {/if}
    {:else}
      {#if capes != null}
        <CapeCarousel on:fetchNoRiskUser={getNoRiskUserByUUID} bind:capes />
      {/if}
    {/if}
  </div>
</div>

<style>
    .wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .cape-wrapper {
        height: 100%;
    }

    .tab-wrapper h1,
    .tab-wrapper h2 {
        font-family: 'Press Start 2P', serif;
        padding: 1em;
        font-size: 1em;
        transition: transform 0.3s, color 0.3s;
    }

    .tab-wrapper h1:hover,
    .tab-wrapper h2:hover {
        transform: scale(1.5);
    }

    .tab-wrapper h1 {
        font-size: 1.5em;
    }

    .tab-wrapper {
        display: flex;
        width: 100%;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .button-wrapper {
        display: flex;
        flex-direction: row;
    }

    .active-tab {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }
</style>
