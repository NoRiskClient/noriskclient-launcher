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

  async function handleNextRequest(inverted) {
    currentRequest = inverted ? (currentRequest > 0 ? currentRequest - 1 : requests.length - 1) : (currentRequest + 1) % requests.length;
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
  <div class="navbar">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="arrow" on:click={() => handleNextRequest(true)}>&lt;</h1>
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}>
      <span>&star;</span> {requests[currentRequest].text} <span>&star;</span></h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="arrow" on:click={() => handleNextRequest(false)}>&gt;</h1>
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
  <!-- svelte-ignore a11y-click-events-have-key-events -->
</div>

<style>
    .wrapper {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .navbar {
        display: flex;
        justify-content: space-between;
        width: 100vw;
        padding: 0px 1em;
        align-items: center;
        flex-direction: row;
        margin-top: 1em;
    }

    .cape-wrapper {
        height: 100%;
    }

    .navbar h1 {
        font-family: 'Press Start 2P', serif;
        padding: 1em;
        font-size: 35px;
        transition: transform 0.3s;
    }

    .navbar h1 span {
        color: gold;
        text-shadow: 3px 2px #5d4c03;
    }

    .navbar h1.arrow {
        cursor: pointer;
        font-size: 25px;
    }

    .navbar h1.arrow:hover {
        transform: scale(1.2);
    }
</style>
