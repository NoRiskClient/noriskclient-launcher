<script>
  import { removeUser, setDefaultUser, users, fetchDefaultUserOrError } from "../../stores/credentialsStore.js";

  export let account;
  export let isActive;
  export let dialog;

  async function handleRemoveAccount() {
    await removeUser(account).then(async value => {
      await fetchDefaultUserOrError();
      if ($users.length === 0) {
        dialog.close();
      }
    });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="flex-wrapper" on:click={() => setDefaultUser(account)} class:active={isActive}>
  <div class="skin-text-wrapper">
    <img src={`https://crafatar.com/avatars/${account.id}?size=50&overlay`} alt="{account.username}'s Kopf">
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
        box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.6);
    }

    .remove-button {
        cursor: pointer;
    }
</style>
