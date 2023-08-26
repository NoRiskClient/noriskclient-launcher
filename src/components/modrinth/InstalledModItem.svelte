<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let mod;

    function getSlug() {
        return mod.value.source.artifact.split(":")[1]
    }
</script>

<div class="mod-item-wrapper" class:enabled={mod.value.enabled} class:disabled={!mod.value.enabled}>
    <div class="image-text-wrapper">
        <img src={mod.image_url} alt="Mod Picture">
        <div class="text-wrapper">
            <a href={"https://modrinth.com/mod/"+getSlug()} target="_blank" title="Modrinth Page">
                {getSlug()}
            </a>
            {#each mod.dependencies as dependency}
                <li>{dependency.value.name}</li>
            {/each}
        </div>
    </div>
    <div class="button-wrapper">
        <h1 class="red-text-clickable disable-button"
            on:click={() => {
                mod.value.enabled = !mod.value.enabled
            }}
            class:enable-button={!mod.value.enabled}
            class:red-text-clickable={mod.value.enabled}>
            {#if mod.value.enabled}
                DISABLE
            {:else}
                ENABLE
            {/if}
        </h1>
        <h1 class="install-button red-text-clickable" on:click={() => dispatch("delete")}>
            DELETE
        </h1>
    </div>
</div>

<style>
    .mod-item-wrapper {
        display: flex;
        border: 3px solid black;
        align-items: center;
        justify-content: space-between;
        padding: 1em;
        gap: 1em;
        margin-top: 0.3em;
    }

    .enabled {
        background-color: rgba(0, 255, 0, 0.5);
    }

    .disabled {
        background-color: rgba(255, 0, 0, 0.5);
    }

    .image-text-wrapper {
        justify-content: center;
        align-items: start;
        display: flex;
        gap: 1em;
    }

    .href-wrapper {
        display: flex;
        align-items: center;
        gap: 0.7em;
    }

    .text-wrapper {

    }

    .href-wrapper div {
        white-space: nowrap;
        font-family: 'Press Start 2P', serif;
        font-size: 9px;
        margin-top: 0.7em;
    }

    .text-item-wrapper {
        height: 100%;
        max-width: 400px;
    }

    .button-wrapper {
        display: flex;
        flex-direction: column;
        gap: 1em;
        align-items: center;
    }

    .mod-item-wrapper img {
        width: 90px;
        height: 90px;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
    }

    .mod-item-wrapper a:first-child {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        font-size: 13px;
        cursor: pointer;
    }

    .enable-button {
        color: #00ff00;
        text-shadow: 2px 2px #086b08;
    }

    .disable-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        transition: transform 0.3s;
    }

    .install-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        transition: transform 0.3s;
    }

    .install-button:hover {
        transform: scale(1.2);
    }

    .disable-button:hover {
        transform: scale(1.2);
    }
</style>
