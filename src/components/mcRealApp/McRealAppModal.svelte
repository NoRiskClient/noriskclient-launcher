<script>
    import { invoke } from "@tauri-apps/api";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import { defaultUser } from "../../stores/credentialsStore.js";
    import { getNoRiskToken } from "../../utils/noriskUtils.js";
    import { addNotification } from "../../stores/notificationStore.js";
    // import qrcode from "qrcode-generator";
    import { translations } from '../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;
  
    export let showModal;
  
    let mobileAppToken;
    let codeContent;
    let showQrCode = false;
  
    let animateOutNow = false;
  
    async function getToken() {
      const token = getNoRiskToken();
      invoke("get_mobile_app_token", { noriskToken: token, uuid: $defaultUser.id }).then(token => {
        mobileAppToken = token;
        codeContent = `{"uuid":"${$defaultUser.id}","experimental":${$launcherOptions.experimentalMode},"token":"${mobileAppToken}"}`;
        // var qr = qrcode(4, 'L');
        // qr.addData(`{"uuid":"${activeAccount.uuid}","experimental":${options.experimentalMode},"token":"${mobileAppToken}`);
        // qr.make();
        // document.getElementById('qrCode').innerHTML = qr.createImgTag();
      }).catch(error => {
        addNotification(lang.settings.popup.mcRealApp.notification.errorWhileGettingMobileAppToken.replace("{error}", error));
        animateOut();
      });
    }
    
    async function resetToken() {
      invoke("reset_mobile_app_token", { noriskToken: getNoRiskToken(), uuid: $defaultUser.id }).then(token => {
        mobileAppToken = token;
        codeContent = `{"uuid":"${$defaultUser.id}","experimental":${$launcherOptions.experimentalMode},"token":"${mobileAppToken}"}`;
        showQrCode = false;
        // var qr = qrcode(4, 'L');
        // qr.addData(`{"uuid":"${activeAccount.uuid}","experimental":${options.experimentalMode},"token":"${mobileAppToken}`);
        // qr.make();
        // document.getElementById('qrCode').innerHTML = qr.createImgTag();
      }).catch(error => {
        addNotification(lang.settings.popup.mcRealApp.notification.errorWhileResettingMobileAppToken.replace("{error}", error));
      });
    }

    function animateOut() {
      animateOutNow = true;
      setTimeout(() => {
        showModal = false;
        animateOutNow = false;
      }, 100);
    }

    function preventSelection(event) {
      event.preventDefault();
    }

    getToken();
  </script>
  
<!-- svelte-ignore a11y-click-events-have-key-events -->
{#if showModal}
<div class="overlay" on:click={animateOut}>
  <div
    class:animateOut={animateOutNow}
    class:animateIn={!animateOutNow}
    class="dialog"
  >
    <div on:click|stopPropagation class="divider">
      <div>
        <div class="header-wrapper">
          <h1 class="nes-font" on:selectstart={preventSelection} on:mousedown={preventSelection}>{lang.settings.popup.mcRealApp.title}</h1>
          <h1 class="nes-font red-text-clickable close-button" on:click={animateOut}>X</h1>
        </div>
        <hr>
        <div class="settings-wrapper">
          <h4 class="nes-font red-text-clickable warning">{lang.settings.popup.mcRealApp.content}</h4>
          <div class="qrCode" id="qrCode"></div>
          {#if codeContent && showQrCode}
            <img class="qrCode" src={`https://qr-generator-putuwaw.vercel.app/api?data=${codeContent}&fill_color=%2300afe8`} alt="">
            <h4 class="nes-font red-text-clickable warning reset" on:click={() => resetToken()}>{lang.settings.popup.mcRealApp.button.reset}</h4>
          {:else}
            <h1 class="nes-font showButton primary-text" on:click={() => showQrCode = true}>{lang.settings.popup.mcRealApp.button.showQrCode}</h1>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
{/if}
  
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

        .overlay {
          position: fixed;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.2);
          z-index: 999998;
        }
        
        .dialog {
          background-color: var(--background-color);
          border: 5px solid black;
          width: 30em;
          height: 40em;
          border-radius: 0.2em;
          padding: 0;
          overflow: hidden;
          position: fixed; /* Fixierte Positionierung */
          top: 50%; /* 50% von oben */
          left: 50%; /* 50% von links */
          transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
          z-index: 999999;
      }
  
      .dialog > div {
          padding: 1em;
      }

    .dialog.animateIn {
        animation: open 0.2s ease-out;
    }

    .dialog.animateOut {
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
            font-size: 30px;
          user-select: none;
          cursor: default;
      }

      .warning {
        font-size: 15px;
        text-align: center;
        line-height: 20px;
        letter-spacing: 1.5px;
        transition-duration: 200ms;
      }

      .showButton {
        font-size: 20px;
        margin-top: 30%;
        text-align: center;
        transition-duration: 200ms;
      }

      .qrCode {
        display: flex;
        justify-self: center;
        align-self: center;
        width: 250px;
      }

      .warning.reset:hover {
        transform: scale(1.2);
      }

      .showButton:hover {
        transform: scale(1.2);
      }
  </style>
  