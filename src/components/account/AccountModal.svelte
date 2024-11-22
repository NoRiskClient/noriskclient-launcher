<script>
  import AccountListItem from "./AccountListItem.svelte";
  import { fetchUsers, users, defaultUser } from "../../stores/credentialsStore.js";
  import { translations } from "../../utils/translationUtils.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../../stores/notificationStore.js";
  import AccountListLoading from "./AccountListLoading.svelte";

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  export let showModal;

  let dialog; // HTMLDialogElement
  $: if (dialog && showModal) openModal();
  let animateOutNow = false;
  let isLoading = false;

  function openModal() {
    fetchUsers();
    dialog.showModal();
  }

  function animateOut() {
    animateOutNow = true;
    setTimeout(() => {
      showModal = false;
      dialog.close();
      animateOutNow = false;
    }, 100);
  }

  function handleAddAccount() {
    isLoading = true;
    invoke("microsoft_auth")
      .then(async result => {
        await fetchUsers();
        isLoading = false;
        addNotification("Account created successfully.", "INFO");
      }).catch(async () => {
      isLoading = false;
    });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  bind:this={dialog}
  class:animateOut={animateOutNow}
  class:animateIn={!animateOutNow}
  on:close={animateOut}
  on:click|self={() => dialog.close()}
>
  <div on:click|stopPropagation class="divider">
    <div>
      <div class="header-wrapper">
        <h1 class="nes-font">{lang.accountModal.title}</h1>
        <h1 class="nes-font red-text-clickable" on:click={animateOut}>X</h1>
      </div>
      <hr>
      {#each $users as account}
        <AccountListItem bind:dialog isActive={$defaultUser?.id === account.id} account={account} />
      {/each}
      {#if isLoading}
        <AccountListLoading />
      {/if}
    </div>
    <!-- svelte-ignore a11y-autofocus -->
    <div class="add-account-button primary-text"
         on:click={handleAddAccount}>{lang.accountModal.addAccountButton}</div>
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
