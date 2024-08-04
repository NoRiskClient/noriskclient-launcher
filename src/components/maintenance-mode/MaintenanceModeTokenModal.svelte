<script>
    import ConfigTextInput from "../config/inputs/ConfigTextInput.svelte";
    import { setMaintenanceMode } from "../../utils/noriskUtils.js";
  
    export let showModal;
    let token = "";
  
    function hideModal() {
      showModal = false;
    }
  
    let dialog; // HTMLDialogElement
  
    $: if (dialog && showModal) dialog.showModal();

    function toggleMaintenanceMode() {
      if (token == "bro_wieso_suchst_du_dannach_?_warte_halt_noch_bissl") {
        setMaintenanceMode(false);
      }
      hideModal();
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
          <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>MAINTENANCE MODE</h1>
          <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
        </div>
        <hr>
        <div class="settings-wrapper">
            <p class="nes-font setting">Enter your maintenance-mode token</p>
          <ConfigTextInput title="" bind:value={token} />
        </div>
      </div>
      <div class="save-token-button-wrapper">
        <p class="green-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={toggleMaintenanceMode}>VERIFY</p>
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
  
      dialog {
          background-color: var(--background-color);
          border: 5px solid black;
          width: 30em;
          height: 18em;
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
        font-size: 16px;
      }
      
      .setting { 
        font-size: 10px;
      }
  
      .nes-font {
          font-family: 'Press Start 2P', serif;
          /* font-size: 30px; */
          user-select: none;
          cursor: default;
      }

      .save-token-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        padding: 1em;
      }
      
      .save-token-button-wrapper p {
        font-family: 'Press Start 2P', serif;
        font-size: 25px;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .save-token-button-wrapper p:hover {
        transform: scale(1.2);
    }
  </style>
  