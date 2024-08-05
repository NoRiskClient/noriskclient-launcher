<script>
  import { invoke } from "@tauri-apps/api/core";
  import { createEventDispatcher } from "svelte";
  import ConfigTextInput from "../config/inputs/ConfigTextInput.svelte";
  import { addNotification } from "../../stores/notificationStore.js";
  import { getNoRiskToken, noriskError } from "../../utils/noriskUtils.js";
  import { defaultUser } from "../../stores/credentialsStore.js";

  const dispatch = createEventDispatcher();

  export let showModal;
  export let friendInviteSlots;

  let friendIdentifier = "";

  async function hideSettings() {
    if (friendIdentifier !== "") {
      dispatch("getInviteSlots");
    }
    showModal = false;
  }

  let dialog; // HTMLDialogElement

  $: if (dialog && showModal) dialog.showModal();

  async function inviteFriend() {
    if (friendIdentifier !== "") {
      await invoke("add_player_to_whitelist", {
        identifier: friendIdentifier,
        noriskToken: getNoRiskToken(),
        requestUuid: $defaultUser.id,
      }).then(() => {
        alert("Successfully invited " + friendIdentifier + " to the NRC closed beta!");
        hideSettings();
      }).catch((e) => {
        noriskError(e);
        addNotification("An error occurred while inviting " + friendIdentifier + " to the NRC closed beta: " + e);
      });
    }
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
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font" on:selectstart={preventSelection} on:mousedown={preventSelection}>INVITE</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={hideSettings}>X</h1>
      </div>
      <hr>
      <div class="settings-wrapper">
        <p>You have
          <b>{ friendInviteSlots.availableSlots === -1 ? '∞' : `${friendInviteSlots.availableSlots - friendInviteSlots.previousInvites}/${friendInviteSlots.availableSlots}`}</b>
          invites left.<br>You can use them to invite a friend to the NRC closed beta.</p>
        <ConfigTextInput title="Username / UUID" bind:value={friendIdentifier} />
      </div>
    </div>
    <h1 class="invite-button" on:click={inviteFriend}>Invite</h1>
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
        height: 25em;
        border-radius: 0.2em;
        overflow: hidden;
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

    .settings-wrapper p {
        font-family: 'Press Start 2P', serif;
        font-size: 13px;
        line-height: 17.5px;
        user-select: none;
        text-align: center;
        margin-bottom: 20px;
    }

    .invite-button {
        font-family: 'Press Start 2P', serif;
        font-size: 25px;
        margin-bottom: 30px;
        color: #00ff00;
        text-shadow: 2px 2px #086b08;
        transition-duration: 0.3s;
        cursor: pointer;
        text-align: center;
    }

    .invite-button:hover {
        transform: scale(1.2);
    }
</style>
