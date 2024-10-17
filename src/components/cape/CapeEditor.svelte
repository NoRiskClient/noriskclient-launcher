<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { getNoRiskToken, noriskLog } from "../../utils/noriskUtils.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import CapePlayer from "./CapePlayer.svelte";

  const dispatch = createEventDispatcher();

  export let capeHash = null;

  onMount(() => {
    dispatch("fetchNoRiskUser");
  });

  async function handleUploadCape() {
    if ($defaultUser) {
      await invoke("upload_cape", {
        noriskToken: getNoRiskToken(),
        uuid: $defaultUser.id,
      }).then((text) => {
        dispatch("fetchNoRiskUser");
        if (text == "") return;
        addNotification(text, "INFO");
      }).catch(reason => {
        addNotification(`Failed to upload cape: ${reason}`);
      });
    }
  }

  async function deleteCape() {
    if ($defaultUser) {
      await invoke("delete_cape", {
        noriskToken: getNoRiskToken(),
        uuid: $defaultUser.id,
      }).then(() => {
        addNotification("Cape deleted successfully.", "INFO");
        capeHash = null;
        dispatch("fetchNoRiskUser");
      }).catch(error => {
        addNotification("Failed to Request User by UUID: " + error);
      });
    }
  }

  async function downloadTemplate() {
    await invoke("download_template_and_open_explorer").then(() => {
      noriskLog("Downloaded Template Cape...");
      addNotification("Template Cape Downloaded!", "INFO", "Template Cape Downloaded!<br><br>Check your downloads folder.", 5000);
    }).catch(error => {
      addNotification("Failed to Download Template: " + error);
    });
  }
</script>

<div in:fade={{ duration: 400 }} class="wrapper">
  {#if capeHash !== null}
    <h1 class="header-text">Your Cape</h1>
    <CapePlayer cape={capeHash} />
  {:else}
    <h1 class="red-text empty-text">[No Cape Uploaded]</h1>
    <div class="empty-cape-wrapper"></div>
  {/if}
  <div class="button-wrapper">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleUploadCape}>UPLOAD</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={downloadTemplate}>TEMPLATE</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="red-text-clickable" on:click={deleteCape}>DELETE</h1>
  </div>
</div>

<style>
    .wrapper {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-content: center;
        align-items: center;
        height: 100%;
        width: 100vw;
    }

    .header-text {
        font-family: 'Press Start 2P', serif;
        font-size: 12.5px;
        margin-bottom: 3em;
        cursor: default;
    }

    .empty-text {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        cursor: default;
    }

    .button-wrapper {
        display: flex;
        gap: 4em;
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

    .empty-cape-wrapper {
        transform: scale(0.8);
        padding: 10px;
        width: 512px;
        height: 280px;
        box-shadow: 0px 0px 3px 0px rgba(0, 0, 0, 0.75);
    }
</style>
