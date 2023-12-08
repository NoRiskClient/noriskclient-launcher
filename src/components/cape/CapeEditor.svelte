<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";

  const dispatch = createEventDispatcher();

  export let capeHash = null;
  export let options;

  onMount(() => {
    dispatch("fetchNoRiskUser");
  });

  async function handleUploadCape() {
    let account = options.accounts.find(obj => obj.uuid === options.currentUuid);
    if (account !== null) {
      await invoke("upload_cape", {
        noriskToken: account.noriskToken,
      }).then(() => {
        dispatch("fetchNoRiskUser");
      });
    }
  }

  async function deleteCape() {
    let account = options.accounts.find(obj => obj.uuid === options.currentUuid);
    if (account !== null) {
      await invoke("delete_cape", {
        noriskToken: account.noriskToken,
      }).then(() => {
        console.debug("Deleted Cape...");
        dispatch("fetchNoRiskUser");
      }).catch(e => {
        alert("Failed to Request User by UUID: " + e);
        console.error(e);
      });
    }
  }

  async function downloadTemplate() {
    await invoke("download_template_and_open_explorer").then(() => {
      console.debug("Downloaded Template Cape...");
    }).catch(e => {
      alert("Failed to Download Template: " + e);
      console.error(e);
    });
  }
</script>

<div in:fade={{ duration: 400 }} class="wrapper">
  {#if capeHash !== null}
    <h1 class="header-text">Your Cape</h1>
    <div class="crop">
      <img src={`https://dl.norisk.gg/capes/prod/${capeHash}.png`} alt="Current Cape">
    </div>
  {:else}
    <h1 class="red-text empty-text">[No Cape Uploaded]</h1>
  {/if}
  <div class="button-wrapper">
    <h1 on:click={handleUploadCape}>UPLOAD</h1>
    <h1 on:click={downloadTemplate}>TEMPLATE</h1>
    <h1 class="red-text-clickable" on:click={deleteCape}>DELETE</h1>
  </div>
</div>

<style>
    .wrapper {
        margin-top: 6em;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-content: center;
        align-items: center;
    }

    .header-text {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        cursor: default;
    }

    .empty-text {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-bottom: 5em;
        cursor: default;
    }

    .button-wrapper {
        display: flex;
        gap: 3em;
    }

    .button-wrapper h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 25px;
        cursor: pointer;
        transition: transform 0.2s;
    }

    .button-wrapper h1:first-child {
        color: #1cc009;
        text-shadow: 2px 2px #114609;
    }

    .button-wrapper h1:hover {
        transform: scale(1.5);
    }

    .crop {
        transform: scale(0.8);
        padding: 10px;
        width: max-content;
        height: 280px;
    }

    .crop img {
        width: 100%;
        height: 100%;
        box-shadow: 0px 0px 3px 0px rgba(0, 0, 0, 0.75);
    }
</style>
