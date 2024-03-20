<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let resourcePack;
    export let text;
    export let type;
</script>

<div class="resourcepack-item-wrapper">
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        {#if type != 'CUSTOM'}
            <img class="icon" src={resourcePack.icon_url} alt="Shader Icon">
        {:else}
            <div class="custom-resourcepack-icon">🎨</div>
        {/if}
        <div class="text-item-wrapper">
            <div class="href-wrapper">
                {#if type != 'CUSTOM'}
                    <a class="resourcepack-title" href={"https://modrinth.com/resourcepack/"+resourcePack.slug} target="_blank" title="Modrinth Page">
                        {resourcePack.title}
                    </a>
                {:else}
                    <a class="resourcepack-title">{resourcePack.replace('.zip', '')}</a>
                {/if}
                {#if resourcePack?.author != undefined && resourcePack?.author != null}
                    <div>by {resourcePack.author}</div>
                {/if}
            </div>
            {#if resourcePack?.description != undefined && resourcePack?.description != null}
                <p>{resourcePack.description}</p>
            {/if}
        </div>
    </div>
    <div class="buttons">
        {#if resourcePack?.loading ?? false}
            <h1 class="required-button">
                LOADING
            </h1>
        {:else if text === "INSTALL"}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="install-button" on:click={() => dispatch("install")}>
                INSTALL
            </h1>
        {:else if text === "INSTALLED"}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="red-text-clickable delete-button" on:click={() => dispatch("delete")}>
                DELETE
            </h1>
        {/if}
    </div>
</div>

<style>
    .resourcepack-item-wrapper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--background-contrast-color);
        height: 120px;
        border-radius: 10px;
        padding: 1em;
        margin-bottom: 10px;
        gap: 1em;
        margin-top: 0.3em;
        cursor: pointer;
    }

    .buttons {
        margin-right: 10px;
    }

    .image-text-wrapper {
        justify-content: center;
        align-items: center;
        display: flex;
        gap: 1em;
    }
    
    .image-text-wrapper img {
        border-radius: 5px;
    }
    
    .custom-resourcepack-icon {
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 45px;
        width: 90px;
        height: 90px;
        border-radius: 5px;
        background: var(--background-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
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

    .icon {
        width: 90px;
        height: 90px;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
    }

    .resourcepack-title {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 18px;
        cursor: pointer;
    }

    .resourcepack-item-wrapper p {
        width: 350px;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        line-height: 1.2em;
        cursor: default;
        padding-top: 2em;
    }

    .install-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .required-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
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
