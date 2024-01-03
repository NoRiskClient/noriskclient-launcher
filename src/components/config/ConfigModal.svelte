<script>
  import ConfigSlider from "./inputs/ConfigSlider.svelte";
  import { invoke } from "@tauri-apps/api";
  import ConfigRadioButton from "./inputs/ConfigRadioButton.svelte";
  import ConfigTextInput from "./inputs/ConfigTextInput.svelte";
  import ConfigFolderInput from "./inputs/ConfigFolderInput.svelte";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  export let showModal;
  export let options;
  export let dataFolderPath;

  function hideSettings() {
    saveData().then(() => {
      dispatch("requestBranches");
    });
    showModal = false;
  }

  let dialog; // HTMLDialogElement

  $: if (dialog && showModal) dialog.showModal();

  async function saveData() {
    options.store();
  }

  async function clearData() {
    // we need await!
    const confirm = await window.confirm("Are you sure you want to erase all saved data?");
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

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<dialog
  bind:this={dialog}
  on:close={hideSettings}
  on:click|self={() => dialog.close()}
>
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font" on:selectstart={preventSelection} on:mousedown={preventSelection}>SETTINGS</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={hideSettings}>X</h1>
      </div>
      <hr>
      <div class="settings-wrapper">
        <ConfigRadioButton bind:value={options.keepLauncherOpen} text="Keep Launcher Open" />
        <ConfigRadioButton bind:value={options.experimentalMode} text="Experimental Mode" />
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
