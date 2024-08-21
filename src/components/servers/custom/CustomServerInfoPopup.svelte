<script>
    import { invoke } from "@tauri-apps/api";
    import { createEventDispatcher } from "svelte";
    import { defaultUser } from "../../../stores/credentialsStore.js";
    import { addNotification } from "../../../stores/notificationStore.js";
    import { getNoRiskToken } from "../../../utils/noriskUtils.js";
    import { openConfirmPopup } from "../../../utils/popupUtils.js";
    import { pop } from "svelte-spa-router";
  
    const dispatch = createEventDispatcher();
  
    export let showModal;
    export let customServer;

    const lastOnline = new Date(customServer.lastOnline);
    const createdAt = new Date(customServer.createdAt); 

    let showMoreDetails = false;
  
    function hideModal() {
      showModal = false;
    }
  
    let dialog; // HTMLDialogElement
  
    $: if (dialog && showModal) dialog.showModal();

    function confirmDelete() {
      openConfirmPopup({
        title: "Delete Server",
        content: "Are you sure you want to delete this server?",
        onConfirm: deleteServer
      });
    }
  
    async function deleteServer() {
      await invoke("delete_custom_server", {
        id: customServer._id,
        token: getNoRiskToken(),
        uuid: $defaultUser.id
      }).then(() => {
        hideModal();
        pop();
        addNotification("Server deleted successfully.", "INFO");
      }).catch((error) => {
        addNotification("Failed to delete server: " + error);
      });
    }
    
    function preventSelection(event) {
      event.preventDefault();
    }
  </script>
  
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <dialog
    bind:this={dialog}
    on:close={hideModal}
    on:click|self={() => dialog.close()}
  >
    <div on:click|stopPropagation class="divider">
      <div>
        <div class="header-wrapper">
          <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>DETAILS <p class="moreDetails" on:click={() => showMoreDetails = !showMoreDetails} title="More Details">👁️</p></h1>
          <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
        </div>
        <hr>
        <div class="settings-wrapper">
            {#if showMoreDetails}
                <div class="setting">
                    <p class="nes-font">ID</p>
                    <p class="nes-font" style="font-size: 10px;">{customServer._id}</p>
                </div>
            {/if}
            <div class="setting">
                <p class="nes-font">Name</p>
                <p class="nes-font" style="font-size: 13.5px;">{customServer.name}</p>
            </div>
            <div class="setting">
                <p class="nes-font">IP</p>
                <p class="nes-font" style="font-size: 13.5px;">{customServer.subdomain}.{customServer.domain}</p>
            </div>
            <div class="setting">
                <p class="nes-font">Type</p>
                <p class="nes-font">{customServer.type}</p>
            </div>
            <div class="setting">
                <p class="nes-font">Version</p>
                <p class="nes-font">{customServer.mcVersion}</p>
            </div>
            {#if customServer.loaderVersion}
            <div class="setting">
                <p class="nes-font">Loader Version</p>
                <p class="nes-font" style="font-size: 10px;">{customServer.loaderVersion}</p>
            </div>
            {/if}
            <div class="setting">
                <p class="nes-font">Last Online</p>
                {#if lastOnline.getFullYear().toString() == "1970"}
                    <p class="nes-font">Never</p>
                {:else}
                    <p class="nes-font">{lastOnline.getDate()}.{lastOnline.getMonth()}.{lastOnline.getFullYear()} {lastOnline.getHours()}:{lastOnline.getMinutes()}</p>
                {/if}
            </div>
            <div class="setting">
                <p class="nes-font">Created At</p>
                <p class="nes-font">{createdAt.getDate()}.{createdAt.getMonth()}.{createdAt.getFullYear()} {createdAt.getHours()}:{createdAt.getMinutes()}</p>
            </div>
        </div>
      </div>
      <div class="delete-button-wrapper">
        <p class="red-text-clickable" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={confirmDelete}>DELETE</p>
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
  
      .settings-wrapper {
          display: flex;
          flex-direction: column;
          margin-top: 1.5em;
          gap: 1em;
      }

      .setting {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
      }
  
      dialog {
          background-color: var(--background-color);
          border: 5px solid black;
          width: 35em;
          height: 26.75em;
          border-radius: 0.2em;
          padding: 0;
          position: fixed; /* Fixierte Positionierung */
          top: 50%; /* 50% von oben */
          left: 50%; /* 50% von links */
          transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
          overflow-y: hidden;
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

      .title {
        align-self: center;
        font-size: 20px;
        display: flex;
        flex-direction: row;
        gap: 1em;
        align-items: center;
      }

      .moreDetails {
        padding-bottom: 7.5px;
        cursor: pointer;
      }
  
      .nes-font {
          font-family: 'Press Start 2P', serif;
          /* font-size: 30px; */
          user-select: none;
          cursor: default;
      }

      .close-button {
        cursor: pointer;
        transition: transform 0.3s;
      }

      .close-button:hover {
        transform: scale(1.2);
      }

      .delete-button-wrapper {
        display: flex;
        justify-content: center;
        align-items: flex-end;
        height: 5em;
      }

      .delete-button-wrapper p {
        cursor: pointer;
        font-size: 22.5px;
        font-family: 'Press Start 2P', serif;
        transition-duration: 200ms;
      }

      .delete-button-wrapper p:hover {
        transform: scale(1.2);
      }
  </style>
  