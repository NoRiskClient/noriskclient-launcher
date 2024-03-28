<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import CapeCarousel from "./CapeCarousel.svelte";
  import CapeEditor from "./CapeEditor.svelte";

  const dispatch = createEventDispatcher()

  export let options;
  let capes = null;
  let capeHash = null;
  let isLoading = true;
  let requests = [
    { text: "CAPE EDIT" },
    { text: "ALLTIME" },
    { text: "WEEKLY" },
    { text: "OWNED" }
  ];
  let currentRequest = 0;

  onMount(() => {
    //requestTrendingCapes(1)
  });

  async function requestTrendingCapes(alltime) {
    let account = options.accounts.find(obj => obj.uuid === options.currentUuid);
    if (account !== null) {
      if (options.currentUuid !== null) {
        await invoke("request_trending_capes", {
          noriskToken: options.experimentalMode ? account.experimentalToken : account.noriskToken,
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
  }

  async function requestOwnedCapes() {
    let account = options.accounts.find(obj => obj.uuid === options.currentUuid);
    if (account !== null) {
      if (options.currentUuid !== null) {
        await invoke("request_owned_capes", {
          noriskToken: options.experimentalMode ? account.experimentalToken : account.noriskToken,
          limit: 30,
        }).then((result) => {
          console.debug("Requesting owned capes", result);
          capes = result;
        }).catch(e => {
          console.error(e);
        });
      }
    }
  }

  async function handleNextRequest() {
    currentRequest = (currentRequest + 1) % requests.length;
    capes = null;
    if (currentRequest === 1) {
      await requestTrendingCapes(1);
    } else if (currentRequest === 2) {
      await requestTrendingCapes(0);
    } else if (currentRequest === 3) {
      await requestOwnedCapes();
    }
  }

  function preventSelection(event) {
    event.preventDefault();
  }

  async function getNoRiskUserByUUID() {
    if (options.currentUuid !== null) {
      await invoke("get_cape_hash_by_uuid", {
        uuid: options.currentUuid,
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
  {#if currentRequest === 0}
    {#if !isLoading}
      <CapeEditor bind:options on:fetchNoRiskUser={getNoRiskUserByUUID} bind:capeHash />
    {/if}
  {:else}
    {#if capes != null}
      <CapeCarousel on:fetchNoRiskUser={getNoRiskUserByUUID} bind:options bind:capes />
    {/if}
  {/if}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
      on:click={handleNextRequest}><span>&star;</span> {requests[currentRequest].text} <span>&star;</span></h1>
</div>
<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>

<style>
    .wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .wrapper h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 35px;
        cursor: pointer;
        position: absolute;
        top: 4em;
        transition: transform 0.3s;
    }

    .wrapper h1 span {
        color: gold;
        text-shadow: 3px 2px #5d4c03;
    }

    .wrapper h1:hover {
        transform: scale(1.2);
    }

    .home-button {
        position: absolute;
        bottom: 1em; /* Abstand vom oberen Rand anpassen */
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .home-button:hover {
        transform: scale(1.2);
    }
</style>
