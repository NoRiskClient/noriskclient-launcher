<script>
    import { invoke } from "@tauri-apps/api";
    import ConfigTextInput from "./inputs/ConfigTextInput.svelte";
    import { createEventDispatcher } from "svelte";
  
    const dispatch = createEventDispatcher();
  
    export let showModal;
    export let options;
  
    function hideModal() {
      showModal = false;
    }
  
    let dialog; // HTMLDialogElement
    let experimentalModeToken = "";
  
    $: if (dialog && showModal) dialog.showModal();
  
    async function save() {
    if (experimentalModeToken == "") return;
      invoke("enable_experimental_mode", { experimentalToken: experimentalModeToken }).then(async allowed => {
        options.experimentalModeToken = experimentalModeToken;
        options.experimentalMode = allowed;
        await options.store();
        hideModal();
        console.log(`Enabled experimental mode: ${allowed}`);
        let existingIndex = options.accounts.findIndex(acc => acc.uuid === options.currentUuid);
          if (options.currentUuid === null || options.accounts[existingIndex].experimentalToken === "" || options.accounts[existingIndex].noriskToken === "") {
            return getNewTokenType();
        }
      }).catch(async e => {
        options.experimentalMode = false;
        options.experimentalModeToken = "";
        await options.store()
        alert(`Failed to enable experimental mode: ${e}`);
        console.error(e);
      })
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

      hideModal();
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
    on:close={hideModal}
    on:click|self={() => dialog.close()}
  >
    <div on:click|stopPropagation class="divider">
      <div>
        <div class="header-wrapper">
          <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>EXPERIMENTAL TOKEN</h1>
          <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
        </div>
        <hr>
        <div class="settings-wrapper">
            <p class="nes-font setting">Please enter your experimental token</p>
          <ConfigTextInput title="" bind:value={experimentalModeToken} />
        </div>
      </div>
      <div class="save-token-button-wrapper">
        <p class="green-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={save}>SAVE</p>
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
        font-family: 'Press Start 2P', serif;
        font-size: 25px;
        padding: 1em;
        text-shadow: 2px 2px #086b08;
    }

    .save-token-button-wrapper p {
        color: #00ff00;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .save-token-button-wrapper p:hover {
        transform: scale(1.2);
    }
  </style>
  