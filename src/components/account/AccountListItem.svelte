<script>
  import { invoke } from "@tauri-apps/api/tauri";

  export let account;
  export let isActive;
  export let options;
  export let dialog;
  export let onSelect;

  function getRandomObjectOrNull(array) {
    if (array.length === 0) {
      return null; // Wenn das Array leer ist, geben wir null zurück
    }

    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
  }
  function handleSelectAccount() {
    if (options.currentUuid !== account.uuid) {
      options.currentUuid = account.uuid;
      options = options;
      options.store();
      onSelect();
    }
  }

  async function handleRemoveAccount() {
    options.accounts = options.accounts.filter(entry => entry.uuid !== account.uuid);
    options.currentUuid = getRandomObjectOrNull(options.accounts)?.uuid ?? null;
    options = options;
    options.store();
    await invoke("remove_account", { loginData: account }).then(() => {
      onSelect();
    });

    if (options.currentUuid === null) {
      dialog.close();
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="flex-wrapper" on:click={handleSelectAccount} class:active={isActive}>
  <div class="skin-text-wrapper">
    <img src={`https://mineskin.eu/helm/${account.uuid}/100.png`} alt="{account.username}'s Kopf">
    <h1 class:active={isActive}>{account.username}</h1>
  </div>
  <h1 class="remove-button" on:click={handleRemoveAccount}>X</h1>
</div>
<hr>

<style>
    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
    }

    .flex-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 30px;
        justify-content: space-between;
        align-content: space-between;
        width: 100%;
        padding: 15px;
        transition: background-color 0.3s;
    }

    .flex-wrapper:hover {
        background: var(--background-contrast-color);
    }

    .active {
      color: #0bb00b;
      text-shadow: 2px 2px #086b08;
    }

    .skin-text-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        width: 100%;
    }

    img {
        width: 50px;
        box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.6);
    }

    .remove-button {
      cursor: pointer;
    }
</style>
