<script>
  import AccountListItem from "./AccountListItem.svelte";
  import { defaultUser, users } from "../../stores/credentialsStore.js";
  import { startMicrosoftAuth } from "../../utils/microsoftUtils.js";

  export let showModal;

  let dialog; // HTMLDialogElement
  $: if (dialog && showModal) dialog.showModal();
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  bind:this={dialog}
  on:close={() => (showModal = false)}
  on:click|self={() => dialog.close()}
>
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font">ACCOUNTS</h1>
        <h1 class="nes-font red-text-clickable" on:click={() => dialog.close()}>X</h1>
      </div>
      <hr>
      {#if $defaultUser}
        {#each $users as account}
          <AccountListItem bind:dialog isActive={$defaultUser.id === account.id} account={account} />
        {/each}
      {/if}
    </div>
    <!-- svelte-ignore a11y-autofocus -->
    <div class="add-account-button primary-text" on:click={startMicrosoftAuth}>ADD ACCOUNT</div>
  </div>
</dialog>

<style>
    .header-wrapper {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 1em;
    }

    .divider {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        padding: 1em;
    }

    dialog {
        width: 30em;
        height: 30em;
        border-radius: 0.2em;
        border: 5px solid black;
        padding: 0;
        position: fixed; /* Fixierte Positionierung */
        top: 50%; /* 50% von oben */
        left: 50%; /* 50% von links */
        overflow: hidden;
        transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
        background-color: var(--background-color);
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
    }

    .add-account-button {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        padding: 1em;
        transition-duration: 200ms;
        cursor: pointer;
    }

    .add-account-button:hover {
        transform: scale(1.15);
    }
</style>
