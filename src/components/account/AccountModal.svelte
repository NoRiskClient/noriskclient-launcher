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

  let animateOutNow = false;
  let isLoading = false;

  async function openModal() {
    await fetchUsers();
    showModal = true;
  }

  function animateOut() {
    animateOutNow = true;
    setTimeout(() => {
      showModal = false;
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
            <h1 class="nes-font">{lang.accountModal.title}</h1>
            <h1 class="nes-font red-text-clickable" on:click={animateOut}>X</h1>
          </div>
          <hr>
          {#each $users as account}
            <AccountListItem isActive={$defaultUser?.id === account.id} account={account} on:close={animateOut} />
          {/each}
          {#if isLoading}
            <AccountListLoading />
          {/if}
        </div>
        <!-- svelte-ignore a11y-autofocus -->
        <div class="add-account-button primary-text"
             on:click={handleAddAccount}>{lang.accountModal.addAccountButton}</div>
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
        background-color: rgba(0, 0, 0, 0.2);
        z-index: 999998;
    }

    .dialog {
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
    }

    .add-account-button {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        padding: 1em;
        transition-duration: 200ms;
        cursor: pointer;
    }

    .add-account-button:hover {
        transform: scale(1.15);
    }
</style>
