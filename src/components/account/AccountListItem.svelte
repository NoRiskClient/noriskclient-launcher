<script>
	import { defaultUser } from './../../stores/credentialsStore.js';
	import { createEventDispatcher } from 'svelte';
    import {fetchUsers, removeUser, setDefaultUser, fetchDefaultUserOrError} from "../../stores/credentialsStore.js";
    import {addNotification} from "../../stores/notificationStore.js";
    import {preventSelection} from "../../utils/svelteUtils.js";

    export let account;
    export let isActive;

    const dispatch = createEventDispatcher();

    function handleRemoveAccount() {
        removeUser(account).then(async value => {
            await fetchUsers();
            await fetchDefaultUserOrError();
            if (!$defaultUser) {
                dispatch('close');
            }
        }).catch((reason) => {
            addNotification(reason);
        });
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="flex-wrapper" class:active={isActive}>
    <div on:selectstart={preventSelection} on:mousedown={preventSelection} class="skin-text-wrapper"
         on:click={() => setDefaultUser(account)}>
        <img src={`https://crafatar.com/avatars/${account.id}?size=50&overlay`} alt="{account.username}'s Kopf">
        <h1 class:green-text={isActive} class:longName={account.username.length > 12}>{account.username}</h1>
    </div>
    <h1 class="remove-button" on:click={handleRemoveAccount}>X</h1>
</div>
<hr>

<style>
    h1 {
        font-size: 18px;
        margin-left: 10px;
    }

    .flex-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
        align-content: space-between;
        width: 100%;
        padding: 15px;
        transition: background-color 0.3s;
    }

    .flex-wrapper:hover {
        background: var(--background-contrast-color);
    }

    .skin-text-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        width: 100%;
        cursor: pointer;
    }

    img {
        box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.6);
        border-radius: 0.2em;
    }

    .longName {
        font-size: 1em;
    }

    .remove-button {
        cursor: pointer;
        transition-duration: 200ms;
    }

    .remove-button:hover {
        color: red;
        text-shadow: 2px 2px #8b0000;
        transform: scale(1.15);
    }
</style>
