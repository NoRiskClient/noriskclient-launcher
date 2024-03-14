<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let profile;
    export let active;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="profile-item-wrapper" on:click={() => dispatch('select')} class:enabled={active}>
    <div class="text-wrapper">
        <h2>{profile.name.length > 20 && profile.name != `${profile.branch} - Default` ? profile.name.substring(0, 20) + '...' : profile.name}</h2>
        <h2 style={profile.name == `${profile.branch} - Default` ? 'margin-left: 4em;' : 'margin-left: 2em;'}>({profile.mods.length} Mods)</h2>
    </div>
    <div class="button-wrapper">
        {#if profile.name != `${profile.branch} - Default`}
            <h1 class="settings-button" title="Edit Profile" on:click={() => dispatch('settings')}>
                ⚙️
            </h1>
        {:else}
            <h1 class="default-info" title="Default Profile">
                📌
            </h1>
        {/if}
    </div>
</div>

<style>
    .profile-item-wrapper {
        display: flex;
        width: 60em;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        font-weight: 300;
        text-shadow: 1px 1px var(--primary-color-text-shadow);
        border: 2px solid black;
        align-items: center;
        justify-content: space-between;
        padding: 1.5em;
        gap: 1em;
        margin-top: 0.5em;
        justify-content: space-between;
    }

    .text-wrapper {
        display: flex;
        flex-direction: row;
    }

    .text-wrapper h2:nth-child(2) {
        align-self: flex-end;
    }

    .enabled {
        border-color: rgba(0, 255, 0, 0.5);
    }

    .settings-button {
        margin-bottom: 3px;
        transition-duration: 100ms;
    }

    .settings-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }

    .default-info {
        color: var(--primary-color);
        text-shadow: 0.85px 0.85px var(--primary-color-text-shadow);
        font-weight: 200;
        font-size: 20px;
    }
</style>
