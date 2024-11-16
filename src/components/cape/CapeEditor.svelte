<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { getNoRiskToken, noriskLog } from "../../utils/noriskUtils.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import CapePlayer from "./CapePlayer.svelte";
  import { translations } from '../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

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
        addNotification(lang.capes.notification.failedToUploadCape, "ERROR", reason);
      });
    }
  }

  async function unequipCape() {
    if ($defaultUser) {
      await invoke("unequip_cape", {
        noriskToken: getNoRiskToken(),
        uuid: $defaultUser.id,
      }).then(() => {
        addNotification(lang.capes.notification.unequip.success, "INFO");
        capeHash = null;
        dispatch("fetchNoRiskUser");
      }).catch(error => {
        addNotification(lang.capes.notification.unequip.error.replace("{error}", error));
      });
    }
  }

  async function downloadTemplate() {
    await invoke("download_template_and_open_explorer").then(() => {
      noriskLog("Downloaded Template Cape...");
      addNotification(lang.capes.notification.downloadTemplate.success.info, "INFO", lang.capes.notification.downloadTemplate.success.details, 5000);
    }).catch(error => {
      addNotification(lang.capes.notification.downloadTemplate.error.replace("{error}", error));
    });
  }
</script>

<div in:fade={{ duration: 400 }} class="wrapper">
  {#if capeHash !== null}
    <h1 class="header-text">{lang.capes.yourCape}</h1>
    <CapePlayer cape={capeHash} />
  {:else}
    <div class="empty-text-wrapper">
      <h1 class="red-text empty-text">[{lang.capes.noCapeUploaded}]</h1>
    </div>
  {/if}
  <div class="button-wrapper">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleUploadCape}>{lang.capes.button.upload}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={downloadTemplate}>{lang.capes.button.template}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="red-text-clickable" on:click={unequipCape}>{lang.capes.button.unequip}</h1>
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

    .empty-text-wrapper {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 300px;
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
</style>
