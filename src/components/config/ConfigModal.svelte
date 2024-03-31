<script>
  import ConfigSlider from "./inputs/ConfigSlider.svelte";
  import { invoke } from "@tauri-apps/api";
  import ConfigRadioButton from "./inputs/ConfigRadioButton.svelte";
  import ConfigTextInput from "./inputs/ConfigTextInput.svelte";
  import ConfigFolderInput from "./inputs/ConfigFolderInput.svelte";
  import { createEventDispatcher } from "svelte";
  import ResetSettingButton from "./inputs/ResetSettingButton.svelte";
  import ExperimentalTokenModal from "./ExperimentalTokenModal.svelte";

  const dispatch = createEventDispatcher();

  export let showModal;
  export let options;
  export let dataFolderPath;

  async function hideSettings() {
    await saveData().then(() => {
      dispatch("requestBranches");
    });
    showModal = false;
  }

  let dialog; // HTMLDialogElement
  let showExperimentalTokenModal = false;

  $: if (dialog && showModal) dialog.showModal();

  async function saveData() {
    await options.store();
  }

  async function clearData() {
    // we need await!
    const confirm = await window.confirm("Are you sure you want to erase all saved data?\nThis will delete all your worlds, mods and settings within the client.")
    if (confirm) {
      invoke("clear_data", { options }).then(() => {
        alert("Data cleared.");
        options.reload();
      }).catch(e => {
        alert("Failed to clear data: " + e);
        console.error(e);
      });
    }
  }

  async function toggleExperimentalMode() {
    if (!options.experimentalMode) {
      return;
    }
    if (options.experimentalModeToken == "") {
      showExperimentalTokenModal = true;
      return;
    }
    const experimentalToken = options.experimentalModeToken != "" ? options.experimentalModeToken : null
    if (!experimentalToken) {
      options.experimentalMode = false;
      return;
    }
    invoke("enable_experimental_mode", { experimentalToken }).then(async allowed => {
      options.experimentalModeToken = experimentalToken;
      options.experimentalMode = allowed;
      console.log(`Enabled experimental mode: ${allowed}`);
    }).catch(e => {
      options.experimentalMode = false;
      options.experimentalModeToken = "";
      alert(`Failed to enable experimental mode: ${e}`);
      console.error(e);
    })
    await options.store();

    let existingIndex = options.accounts.findIndex(acc => acc.uuid === options.currentUuid);
    if (options.currentUuid === null || options.accounts[existingIndex].experimentalToken === "" || options.accounts[existingIndex].noriskToken === "") {
      return getNewTokenType();
    }
  }

  async function getNewTokenType() {
    await invoke("login_norisk_microsoft", { options }).then(async (loginData) => {
      console.debug("Received Login Data...", loginData);

      options.currentUuid = loginData.uuid;

      // Index des vorhandenen Objekts mit derselben UUID suchen
      let existingIndex = options.accounts.findIndex(obj => obj.uuid === loginData.uuid);
      if (existingIndex !== -1) {
        console.debug("Replace Account");
        options.accounts[existingIndex] = {
          uuid: loginData.uuid,
          username: loginData.username,
          mcToken: loginData.mcToken,
          accessToken: loginData.accessToken,
          refreshToken: loginData.refreshToken,
          experimentalToken: loginData.experimentalToken !== "" ? loginData.experimentalToken : options.accounts[existingIndex].experimentalToken,
          noriskToken: loginData.noriskToken !== "" ? loginData.noriskToken : options.accounts[existingIndex].noriskToken,
        };
      } else {
        console.debug("Add New Account");
        options.accounts.push(loginData);
      }

      hideSettings();
    }).catch(e => {
      console.error("microsoft authentication error", e);
      alert(e);
    });
  }

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  bind:this={dialog}
  on:close={hideSettings}
  on:click|self={() => dialog.close()}
>
<div class="content">
  {#if showExperimentalTokenModal}
    <ExperimentalTokenModal bind:options bind:showModal={showExperimentalTokenModal} />
  {/if}
</div>
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font" on:selectstart={preventSelection} on:mousedown={preventSelection}>SETTINGS</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={hideSettings}>X</h1>
      </div>
      <hr>
      <div class="settings-wrapper">
        <ConfigRadioButton bind:value={options.keepLauncherOpen} text="Keep Launcher Open" />
        <div class="experimental-mode-wrapper">
          <ConfigRadioButton on:toggle={toggleExperimentalMode} bind:value={options.experimentalMode} text="Experimental Mode" />
          {#if options.experimentalModeToken != ""}
            <ResetSettingButton bind:setting={options.experimentalModeToken} defaultValue="" tooltip="Clear cached token" />
          {/if}
        </div>
        <ConfigSlider title="RAM" suffix="%" min={20} max={100} bind:value={options.memoryPercentage} step={1} />
        <ConfigSlider title="Max Downloads" suffix="" min={1} max={50} bind:value={options.concurrentDownloads}
                      step={1} />
        <ConfigFolderInput title="Java Path" bind:value={options.customJavaPath} />
        <ConfigTextInput title="Custom JVM args" bind:value={options.customJavaArgs} />
        <ConfigFolderInput title="Data Folder" bind:value={options.dataPath} />
      </div>
    </div>
    <!-- svelte-ignore a11y-autofocus -->
    <div class="clear-data-button-wrapper">
      <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={clearData}>CLEAR
        DATA</p>
    </div>
  </div>
</dialog>

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

    content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
        gap: 20px;
        padding: 20px; /* Innenabstand für den Schlagschatten */
    }

    .settings-wrapper {
        display: flex;
        flex-direction: column;
        margin-top: 1.5em;
        gap: 1em;
    }

    .divider {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        padding: 1em;
    }

    dialog {
        background-color: var(--background-color);
        border: 5px solid black;
        width: 34em;
        height: 42em;
        border-radius: 0.2em;
        padding: 0;
        position: fixed; /* Fixierte Positionierung */
        top: 50%; /* 50% von oben */
        left: 50%; /* 50% von links */
        transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
    }

    dialog::backdrop {
        background: rgba(0, 0, 0, 0.3);
    }

    dialog > div {
        padding: 1em;
    }

    dialog[open]::backdrop {
        animation: fade 0.2s ease-out;
    }

    @keyframes fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
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

    .clear-data-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        padding: 1em;
        text-shadow: 2px 2px #6e0000;
    }

    .clear-data-button-wrapper p {
        color: #ff0000;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .clear-data-button-wrapper p:hover {
        transform: scale(1.2);
    }
</style>
