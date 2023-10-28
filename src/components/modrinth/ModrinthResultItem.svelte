<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let mod;
    export let text;
</script>

<div class="mod-item-wrapper">
    <div class="image-text-wrapper">
        <img src={mod.icon_url} alt="Mod Picture">
        <div class="text-item-wrapper">
            <div class="href-wrapper">
                <a href={"https://modrinth.com/mod/"+mod.slug} target="_blank" title="Modrinth Page">
                    {mod.title}
                </a>
                {#if mod.author !== null}
                    <div>by {mod.author}</div>
                {/if}
            </div>
            <p>{mod.description}</p>
        </div>
    </div>
    {#if mod?.loading ?? false}
        <h1 class="required-button">
            LOADING
        </h1>
    {:else if text === "REQUIRED"}
        <h1 class="required-button">
            REQUIRED
        </h1>
    {:else if text === "INSTALL"}
        <h1 class="install-button" on:click={() => dispatch("install")}>
            INSTALL
        </h1>
    {:else if text === "INSTALLED"}
        <h1 class="red-text-clickable delete-button" on:click={() => dispatch("delete")}>
            DELETE
        </h1>
    {/if}
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
        font-size: 18px;
        cursor: pointer;
    }

    .mod-item-wrapper p {
        width: 350px;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        line-height: 1.2em;
        cursor: default;
        padding-top: 2em;
    }

    .required-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
        transition: transform 0.3s;
    }

    .install-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .delete-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .delete-button:hover {
        transform: scale(1.2);
    }

    .install-button:hover {
        transform: scale(1.2);
    }
</style>
