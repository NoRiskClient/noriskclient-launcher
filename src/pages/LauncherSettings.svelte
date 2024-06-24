<!-- pages/Home.svelte -->
<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import ConfigTextInput from "../components/config/inputs/ConfigTextInput.svelte";
  import ConfigSlider from "../components/config/inputs/ConfigSlider.svelte";
  import ConfigRadioButton from "../components/config/inputs/ConfigRadioButton.svelte";
  import ConfigFolderInput from "../components/config/inputs/ConfigFolderInput.svelte";
  import { fetchOptions, launcherOptions, saveOptions } from "../stores/optionsStore.js";
  import { preventSelection } from "../utils/svelteUtils.js";
  import { pop } from "svelte-spa-router";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";
  import ExperimentalTokenModal from "../components/config/ExperimentalTokenModal.svelte";
  import { onDestroy } from "svelte";
  import { defaultUser, fetchDefaultUserOrError } from "../stores/credentialsStore.js";
  import { updateNoRiskToken } from "../stores/credentialsStore.js";
  import { fetchBranches } from "../stores/branchesStore.js";
  import { fetchProfiles } from "../stores/profilesStore.js";

  $: lightTheme = $launcherOptions?.theme === "LIGHT";
  let showExperimentalTokenModal = false;

  function toggleTheme() {
    $launcherOptions.toggleTheme();
    lightTheme = $launcherOptions.theme === "LIGHT";
  }

  async function clearData() {
    // we need await!
    const confirm = await window.confirm("Are you sure you want to erase all saved data?\nThis will delete all your worlds, mods and settings within the client.");
    if (confirm) {
      invoke("clear_data", { options: $launcherOptions })
        .then(async () => {
          alert("Data cleared.");
          await fetchOptions();
          await fetchDefaultUserOrError(false);
          await fetchBranches();
          await fetchProfiles();
        })
        .catch(e => {
          addNotification(e);
        });
    }
  }

  async function toggleExperimentalMode() {
    if (!$launcherOptions.experimentalMode) {
      return;
    }
    if ($launcherOptions.experimentalMode) {
      showExperimentalTokenModal = true;
      $launcherOptions.experimentalMode = false;
      return;
    }

    await saveOptions();
  }

  onDestroy(async () => {
    await saveOptions();
  });

  async function closeAndSave() {
    await pop();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<TransitionWrapper>
  {#if showExperimentalTokenModal}
    <ExperimentalTokenModal bind:showModal={showExperimentalTokenModal} />
  {/if}
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font" on:selectstart={preventSelection} on:mousedown={preventSelection}>SETTINGS</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={closeAndSave}>X</h1>
      </div>
      <hr>
      <div class="settings-wrapper">
        <ConfigRadioButton bind:value={$launcherOptions.keepLauncherOpen} text="Keep Launcher Open" />
        <div class="experimental-mode-wrapper">
          <ConfigRadioButton on:toggle={toggleExperimentalMode} bind:value={$launcherOptions.experimentalMode}
                             text="Experimental Mode" />
        </div>
        <ConfigRadioButton bind:value={lightTheme} on:toggle={toggleTheme} text={`Theme: ${$launcherOptions.theme}`} />
        <!-- TODO Sorry Tim aber die Invalid Session ist bei mir im Reallife angekommen
        {#if featureWhitelist.includes("MCREAL_APP")}
          <div class="mcreal-app-wrapper">
            <h1 class="title">MCReal App</h1>
            <h1 class="button" on:click={() => { hideSettings(); showMcRealAppModal = true; }}>Details</h1>
          </div>
        {/if}
        -->
        <ConfigSlider title="RAM" suffix="%" min={20} max={100} bind:value={$launcherOptions.memoryPercentage}
                      step={1} />
        <ConfigSlider title="Max Downloads" suffix="" min={1} max={50} bind:value={$launcherOptions.concurrentDownloads}
                      step={1} />
        <!-- disabled for now since the rust backend for that feature does not work properly and nobody uses it anyways!? -->
        <!-- <ConfigFolderInput title="Java Path" bind:value={$launcherOptions.customJavaPath} /> -->
        <ConfigTextInput title="Custom JVM args" bind:value={$launcherOptions.customJavaArgs} />
        <ConfigFolderInput title="Data Folder" bind:value={$launcherOptions.dataPath} />
        <div class="clear-data-button-wrapper">
          <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={clearData}>
            [CLEAR DATA]</p>
        </div>
      </div>
    </div>
    <!-- svelte-ignore a11y-autofocus -->
  </div>
</TransitionWrapper>

<style>
    .header-wrapper {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 1em;
    }

    .close-button {
        transition: transform 0.3s;
    }

    .close-button:hover {
        transition: transform 0.3s;
        transform: scale(1.2);
    }

    .divider {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        padding: 1em;
    }

    @keyframes fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .settings-wrapper {
        display: flex;
        flex-direction: column;
        margin-top: 1.5em;
        gap: 1em;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        user-select: none;
        cursor: default;
    }

    .experimental-mode-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
    }

    .mcreal-app-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
    }

    .mcreal-app-wrapper > .title {
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        color: white;
    }

    .mcreal-app-wrapper > .button {
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        color: var(--primary-color);
        cursor: pointer;
        transition: transform 0.3s;
    }

    .mcreal-app-wrapper > .button:hover {
        transform: scale(1.15);
    }

    .clear-data-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        text-shadow: 2px 2px #6e0000;
    }

    .clear-data-button-wrapper p {
        color: #ff0000;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .clear-data-button-wrapper p:hover {
        transform: scale(1.2);
    }
</style>
