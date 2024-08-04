<script>
    import { preventSelection } from "../../utils/svelteUtils.js";
    import { createEventDispatcher } from "svelte";
    import ConfigFolderInput from "../config/inputs/ConfigFolderInput.svelte";

    const dispatch = createEventDispatcher();

    export let showModal;
    export let path;

    function hideModal() {
        showModal = false;
    }

    function clone() {
        dispatch('clone');
        hideModal();
    }

    let dialog; // HTMLDialogElement

    $: if (dialog && showModal) dialog.showModal();
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
        <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>SELECT MINECRAFT PATH</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
      </div>
      <hr>
      <div class="content">
        <p>Please select the minecraft data path you want to clone the data from.<br>The default value is your normal ".minecraft" folder.</p>
        <ConfigFolderInput title={""} bind:value={path} />
        <h1 class="primary-text" on:click={clone}>Clone</h1>
      </div>
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

    .content {
        display: flex;
        height: 14em;
        flex-direction: column;
        margin-top: 1.5em;
        justify-content: space-between;
        align-items: center;
    }

    dialog {
        background-color: var(--background-color);
        border: 3.5px solid black;
        width: 32em;
        height: 22em;
        border-radius: 0.2em;
        padding: 0;
        position: fixed; /* Fixierte Positionierung */
        top: 50%; /* 50% von oben */
        left: 50%; /* 50% von links */
        transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
        overflow: hidden;
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
        font-size: 15px ;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        /* font-size: 30px; */
        user-select: none;
        cursor: default;
    }

    .content p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        text-align: center;
        line-height: 15px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
    }

    .content h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        text-align: center;
        cursor: pointer;
        width: min-content;
        margin-top: 2em;
        margin-bottom: 1em;
        transition-duration: 200ms;
    }

    .content h1:hover {
        transform: scale(1.2);
    }
</style>