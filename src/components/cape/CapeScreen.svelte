<script>
	import CapePlayer from './CapePlayer.svelte';
  import { invoke } from "@tauri-apps/api/tauri";
  import CapeCarousel from "./CapeCarousel.svelte";
  import CapeEditor from "./CapeEditor.svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import { openInputPopup } from "../../utils/popupUtils.js";
  import { noriskLog } from "../../utils/noriskUtils.js";
  import { translations } from '../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  let capes = null;
  let userCapes = null;
  let capeHash = null;
  let isLoading = true;
  let currentRequest = 0;
  let previewHash = null;
  let previewData = null;

  async function requestTrendingCapes(alltime) {
    if ($defaultUser) {
      await invoke("request_trending_capes", {
        noriskToken: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id,
        alltime: alltime,
        limit: 30,
      }).then((result) => {
        noriskLog("Requesting Trending capes: " + JSON.stringify(result));
        capes = result;
      }).catch(error => {
        addNotification(error);
      });
    }
  }

  async function requestUserCapes(username) {
    if ($defaultUser) {
      await invoke("request_user_capes", {
        noriskToken: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id,
        username: username,
        limit: 30,
      }).then((result) => {
        noriskLog("Requesting User capes: " + JSON.stringify(result));
        capes = result;
      }).catch(error => {
        addNotification(error);
      });
    }
  }

  async function requestOwnedCapes() {
    if ($defaultUser) {
      await invoke("request_owned_capes", {
        noriskToken: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
        uuid: $defaultUser.id
      }).then((result) => {
        noriskLog("Requesting Owned capes: " + JSON.stringify(result));
        capes = result;
      }).catch(error => {
        addNotification(error);
      });
    }
  }

  async function switchTab(tab) {
    const oldRequest = currentRequest > -1 ? currentRequest : 0;
    currentRequest = tab;
    capes = null;
    if (currentRequest != 3) {
      userCapes = null;
    }
    if (currentRequest === 1) {
      await requestTrendingCapes(1);
    } else if (currentRequest === 2) {
      await requestTrendingCapes(0);
    } else if (currentRequest === 3) {
      openInputPopup({
        title: lang.capes.popup.search.title,
        content: lang.capes.popup.search.content,
        inputPlaceholder: lang.capes.popup.search.inputPlaceholder,
        confirmButton: lang.capes.popup.search.confirmButton,
        validateInput: (value) => value.length >= 3 && value.length <= 16,
        onConfirm: requestUserCapes,
        onCancel: () => { switchTab(oldRequest) }
      });
    } else if (currentRequest === 4) {
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
          noriskLog("No cape found for user: " + $defaultUser.id);
        }
        isLoading = false;
      }).catch(error => {
        addNotification(lang.capes.notification.failedToRequestUserByUUID.replace("{error}", error));
        isLoading = false;
      });
    }
  }

  function previewCape(hash, data) {
    previewHash = hash;
    previewData = data;
    isLoading = true;

    // ja das braucht man. nicht hinterfragen. :)
    setTimeout(() => {
      currentRequest = -1;
      isLoading = false;
    }, 0);
  }

  getNoRiskUserByUUID();
</script>

<div class="wrapper">
  <div class="tab-wrapper">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={() => switchTab(0)} class:primary-text={currentRequest === 0}>{lang.capes.navbar.editor}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="button-wrapper">
      <h2 on:click={() => switchTab(1)} class:primary-text={currentRequest === 1}>{lang.capes.navbar.alltime}</h2>
      <h2 on:click={() => switchTab(2)} class:primary-text={currentRequest === 2}>{lang.capes.navbar.weekly}</h2>
      <h2 on:click={() => switchTab(3)} class:primary-text={currentRequest === 3}>{lang.capes.navbar.search}</h2>
      <h2 on:click={() => switchTab(4)} class:primary-text={currentRequest === 4}>{lang.capes.navbar.owned}</h2>
    </div>
  </div>
  <div class="cape-wrapper">
    {#if currentRequest === -1}
      <div class="preview-player">
        <CapePlayer bind:cape={previewHash} bind:data={previewData} height={350} width={350} />
      </div>
    {:else if currentRequest === 0}
      {#if !isLoading}
        <CapeEditor on:fetchNoRiskUser={getNoRiskUserByUUID} on:preview={(data) => previewCape(null, data.detail)} bind:capeHash />
      {/if}
    {:else if currentRequest === 1 || currentRequest === 2 || currentRequest === 3 || currentRequest === 4}
      {#if capes != null && !isLoading}
        <CapeCarousel on:fetchNoRiskUser={getNoRiskUserByUUID} on:preview={(data) => previewCape(data.detail)} bind:capes allowDelete={currentRequest === 4} />
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

    .preview-player {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>
