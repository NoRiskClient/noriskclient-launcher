<!-- pages/Home.svelte -->
<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import ConfigTextInput from "../components/config/inputs/ConfigTextInput.svelte";
  import ConfigSlider from "../components/config/inputs/ConfigSlider.svelte";
  import ConfigRadioButton from "../components/config/inputs/ConfigRadioButton.svelte";
  import ConfigFolderInput from "../components/config/inputs/ConfigFolderInput.svelte";
  import ConfigFileInput from "../components/config/inputs/ConfigFileInput.svelte";
  import McRealAppModal from "../components/mcRealApp/McRealAppModal.svelte";
  import { fetchOptions, launcherOptions, saveOptions } from "../stores/optionsStore.js";
  import { preventSelection } from "../utils/svelteUtils.js";
  import { pop } from "svelte-spa-router";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";
  import ExperimentalTokenModal from "../components/config/ExperimentalTokenModal.svelte";
  import { onDestroy } from "svelte";
  import { fetchDefaultUserOrError, defaultUser } from "../stores/credentialsStore.js";
  import { fetchBranches } from "../stores/branchesStore.js";
  import { fetchProfiles } from "../stores/profilesStore.js";
  import { featureWhitelist, noriskUser, isInMaintenanceMode, setMaintenanceMode } from "../utils/noriskUtils.js";

  $: lightTheme = $launcherOptions?.theme === "LIGHT";
  let showExperimentalTokenModal = false;
  let showMcRealAppModal = false;

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

  function toggleMaintenanceMode() {
    invoke("toggle_maintenance_mode", {
      maintenanceMode: $isInMaintenanceMode,
      options: $launcherOptions,
      credentials: $defaultUser
    })
      .then(async (result) => {
        const newState = result.includes("true");
        setMaintenanceMode(newState);
        alert("Maintenance mode is now " + (newState ? "enabled" : "disabled") + "!");
      })
      .catch(e => {
        addNotification(`Failed to toggle maintenance mode: ${e}`);
      });
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
  {:else if showMcRealAppModal}
    <McRealAppModal bind:showModal={showMcRealAppModal} />
  {/if}
  <div on:click|stopPropagation class="settings-container">
    <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>SETTINGS</h1>
    <hr>
    <div class="settings-wrapper">
      <ConfigRadioButton bind:value={$launcherOptions.keepLauncherOpen} text="Keep Launcher Open" />
      {#if $noriskUser?.isDev}
        <ConfigRadioButton text="Experimental Mode" bind:value={$launcherOptions.experimentalMode} isDevOnly={true} on:toggle={toggleExperimentalMode} />
        <ConfigRadioButton text="Launcher Maintenance Mode" bind:value={$isInMaintenanceMode} isDevOnly={true} on:toggle={toggleMaintenanceMode} />
      {/if}
      <ConfigRadioButton text={`Theme: ${$launcherOptions.theme}`} bind:value={lightTheme} on:toggle={toggleTheme} />
      {#if $featureWhitelist.includes("MCREAL_APP")}
        <div class="mcreal-app-wrapper">
          <h1 class="title">MCReal App</h1>
          <h1 class="button" on:click={() => { showMcRealAppModal = true; }}>Details</h1>
        </div>
      {/if}
      <div class="sliders">
        <ConfigSlider title="RAM" suffix="%" min={20} max={100} bind:value={$launcherOptions.memoryPercentage} step={1} />
        <ConfigSlider title="Max Downloads" suffix="" min={1} max={50} bind:value={$launcherOptions.concurrentDownloads} step={1} />
      </div>
      <ConfigFileInput title="Custom Java Path" bind:value={$launcherOptions.customJavaPath} extentions={["exe"]} requiredFileName={"javaw"} defaultValue={""} />
      <ConfigTextInput title="Custom JVM args" bind:value={$launcherOptions.customJavaArgs} />
      <ConfigFolderInput title="Data Folder" bind:value={$launcherOptions.dataPath} />
      <div class="clear-data-button-wrapper">
        <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={clearData}>[CLEAR DATA]</p>
      </div>
    </div>
  </div>
  <!-- svelte-ignore a11y-autofocus -->
</TransitionWrapper>

<style>
    .settings-container {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        overflow: hidden;
        height: 80vh;
        padding-top: 1em;
    }

    hr {
        width: 85%;
        border: 1px solid white;
        margin-top: 1.5em;
    }

    .title {
      text-align: center;
      margin-top: 10px;
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
        margin-top: 2em;
        gap: 1.15em;
        width: 80vw;
        padding: 0px 2em 2em 2em;
        overflow: scroll;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        user-select: none;
        cursor: default;
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
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: pointer;
        transition: transform 0.3s;
    }

    .mcreal-app-wrapper > .button:hover {
        transform: scale(1.15);
    }

    .sliders {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        gap: 2em;
    }

    .clear-data-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        height: 3em;
        margin-top: 1.5em;
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
