<script>
	import { translations } from './../../../utils/translationUtils.js';
  import { preventSelection } from "../../../utils/svelteUtils.js";

  export let showModal;
  export let reason;

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  function hideModal() {
    showModal = false;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
{#if showModal}
  <div class="overlay" on:click={hideModal}>
    <div class="dialog">
      <div on:click|stopPropagation class="divider">
        <div>
          <div class="header-wrapper">
            <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>{lang.launchErrorModal.title}</h1>
            <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
          </div>
          <hr>
          <div class="content">
            <div class="credit">
              <p class="nes-font">{reason}</p>
            </div>
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

    .content {
        display: flex;
        flex-direction: column;
        margin-top: 1.5em;
        gap: 1em;
    }

    .content > .credit {
      font-size: 0.9em;
      display: flex;
      justify-content: flex-start;
      align-items: center;
      flex-direction: row;
      gap: 1em;
    }

    .overlay {
      position: fixed;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.2);
      z-index: 999998;
    }

    .dialog {
        background-color: var(--background-color);
        border: 3.5px solid black;
        width: 50em;
        height: 19em;
        border-radius: 0.2em;
        padding: 0;
        position: fixed; /* Fixierte Positionierung */
        top: 50%; /* 50% von oben */
        left: 50%; /* 50% von links */
        transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
        overflow-y: hidden;
        z-index: 999999;
    }

    .dialog > div {
        padding: 1em;
    }

    .title {
        align-self: center;
        font-size: 18px;
    }

    .nes-font {
            /* font-size: 30px; */
        user-select: none;
        cursor: default;
    }
</style>
