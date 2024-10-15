<script>
  import { createEventDispatcher } from "svelte";
  import ConfigTextInput from "../config/inputs/ConfigTextInput.svelte";
  import { openConfirmPopup } from "../../utils/popupUtils.js";
  import { noriskLog } from "../../utils/noriskUtils.js";
  import { addNotification } from "../../stores/notificationStore.js";

  const dispatch = createEventDispatcher()

  export let showModal;
  export let experimentalMode;
  export let launcherProfiles;
  export let settingsProfile;
  export let createMode = false;

  function closeSettings() {
    if (!createMode) {
        saveData()
    }
    animateOut();
  }

  const ILLIGAL_CHARACTERS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

  let dialog; // HTMLDialogElement

  $: if (dialog && showModal) dialog.showModal();
  let animateOutNow = false;

  async function saveData() {
    if (settingsProfile.name == '') {
        settingsProfile.name = "Empty Name?";
    } else if (settingsProfile.name.split('').some(c => ILLIGAL_CHARACTERS.includes(c))) {
        addNotification("Profile name contains illegal characters.", "ERROR");
        return;
    }
    if (experimentalMode) {
        launcherProfiles.experimentalProfiles[launcherProfiles.experimentalProfiles.indexOf(settingsProfile)] = settingsProfile;
    } else {
        launcherProfiles.mainProfiles[launcherProfiles.mainProfiles.indexOf(settingsProfile)] = settingsProfile;
    }
    launcherProfiles.store();
    dispatch('update');
  }

  function confirmDelete() {
    openConfirmPopup({
      title: "Delete Profile",
      content: "Are you sure you want to delete this profile?",
      onConfirm: deleteProfile
    });
  }

  async function deleteProfile() {
    noriskLog(`DELETING PROFILE: ${settingsProfile.name} (${settingsProfile.branch})`);
    if (experimentalMode) {
        launcherProfiles.experimentalProfiles.splice(launcherProfiles.experimentalProfiles.indexOf(settingsProfile), 1);
        launcherProfiles.selectedExperimentalProfiles[settingsProfile.branch] = launcherProfiles.experimentalProfiles[0].id;
    } else {
        launcherProfiles.mainProfiles.splice(launcherProfiles.mainProfiles.indexOf(settingsProfile), 1);
        launcherProfiles.selectedMainProfiles[settingsProfile.branch] = launcherProfiles.mainProfiles[0].id;
    }
    closeSettings();
    addNotification(`Profile "${settingsProfile.name}" has been deleted.`, "INFO");
    dispatch('update');
  }

  async function createProfile() {
    if (settingsProfile.name == '' || settingsProfile.name.toLowerCase() == `${settingsProfile.branch} - Default`.toLowerCase()) return;
    if (settingsProfile.name.split('').some(c => ILLIGAL_CHARACTERS.includes(c))) {
        addNotification("Profile name contains illegal characters.", "ERROR");
        return;
    }
    noriskLog(`CREATING PROFILE: ${settingsProfile.name} (${settingsProfile.branch})`);
    if (experimentalMode) {
        launcherProfiles.experimentalProfiles.push(settingsProfile);
        launcherProfiles.selectedExperimentalProfiles[settingsProfile.branch] = settingsProfile.id;
    } else {
        launcherProfiles.mainProfiles.push(settingsProfile);
        launcherProfiles.selectedMainProfiles[settingsProfile.branch] = settingsProfile.id;
    }
    launcherProfiles.store();
    closeSettings();
    addNotification(`Profile "${settingsProfile.name}" has been created.`, "INFO");
    dispatch('update');
  }

  function animateOut() {
    animateOutNow = true;
    setTimeout(() => {
      showModal = false;
      dialog.close();
    }, 100);
  }

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  bind:this={dialog}
  class:animateOut={animateOutNow}
  class:animateIn={!animateOutNow}
  on:close={closeSettings}
  on:click|self={() => dialog.close()}
>
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        {#if createMode}
          <h1 class="title" on:selectstart={preventSelection} on:mousedown={preventSelection}>CREATE PROFILE</h1>
        {:else}
          <h1 class="title" on:selectstart={preventSelection} on:mousedown={preventSelection}>PROFILE SETTINGS</h1>
        {/if}
        <h1 class="nes-font red-text-clickable close-button" on:click={closeSettings}>X</h1>
      </div>
      <hr>
      <div class="settings-wrapper">
        <ConfigTextInput title="Name" bind:value={settingsProfile.name} />
        <ConfigTextInput title="Branch" bind:value={settingsProfile.branch} disabled={true} />
      </div>
    </div>
    <!-- svelte-ignore a11y-autofocus -->
    {#if createMode}
      <div class="create-profile-button-wrapper">
        <p class="green-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={createProfile}>CREATE</p>
      </div>
    {:else}
      <div class="delete-profile-button-wrapper">
        <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={confirmDelete}>DELETE PROFILE</p>
      </div>
    {/if}
  </div>
</dialog>

<style>
    .header-wrapper {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 1em;
    }

    .header-wrapper .title {
        font-family: 'Press Start 2P', serif;
        font-size: 22.5px;
        user-select: none;
        cursor: default;
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
        height: 23.25em;
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

    dialog.animateIn {
        animation: open 0.2s ease-out;
    }

    dialog.animateOut {
        animation: close 0.2s ease-out;
    }

    @keyframes fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes open {
        from {
            transform: translate(-50%, 200%);
            opacity: 0;
        }
        to {
            transform: translate(-50%, -50%);
            opacity: 1;
        }
    }

    @keyframes close {
        from {
            transform: translate(-50%, -50%);
            opacity: 1;
        }
        to {
            transform: translate(-50%, 200%);
            opacity: 0;
        }
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        user-select: none;
        cursor: default;
    }

    .create-profile-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        padding: 1em;
      }
      
      .create-profile-button-wrapper p {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .create-profile-button-wrapper p:hover {
        transform: scale(1.2);
    }

    .delete-profile-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        padding: 1em;
        text-shadow: 2px 2px #6e0000;
    }

    .delete-profile-button-wrapper p {
        color: #ff0000;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .delete-profile-button-wrapper p:hover {
        transform: scale(1.2);
    }
</style>
