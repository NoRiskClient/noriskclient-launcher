<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let resourcePack;
    export let text;
    export let type;

    function getMinimalisticDownloadCount() {
        if (resourcePack?.downloads < 1000) {
            return resourcePack?.downloads;
        } else if (resourcePack?.downloads < 1000000) {
            return (resourcePack?.downloads / 1000).toFixed(1) + "K";
        } else {
            return (resourcePack?.downloads / 1000000).toFixed(1) + "M";
        }
    }
</script>

<div class="resourcepack-item-wrapper" class:blacklisted={resourcePack?.blacklisted}>
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        {#if type != 'CUSTOM'}
            <div class="icon-fallback">
                <img class="icon" src={resourcePack.icon_url} alt=" " onerror="this.style.display='none'">
            </div>
        {:else}
            <div class="custom-resourcepack-icon">🎨</div>
        {/if}
        <div class="text-item-wrapper">
            <div class="href-wrapper">
                {#if type != 'CUSTOM'}
                    <div class="name-div">
                        <a class="resourcepack-title" href={`https://modrinth.com/mod/${resourcePack.slug}`} target="_blank" title={resourcePack.title}>
                            {resourcePack.title.length > 20 ? resourcePack.title.substring(0, resourcePack?.featured ? 17 : 20) + '...' : resourcePack.title}
                        </a>
                        {#if resourcePack?.featured}
                            <p class="featured" title="Featured">⭐️</p>
                        {/if}
                    </div>
                {:else}
                    <!-- svelte-ignore a11y-missing-attribute -->
                    <a class="resourcepack-title">{resourcePack.replace('.jar', '').replace('.disabled', '')}</a>
                {/if}
                {#if resourcePack?.author != undefined && resourcePack?.author != null}
                    <div class="author-container">
                        <p class="author">by {resourcePack.author ?? resourcePack.value.author}</p>
                        <b>•</b>
                        <p class="download-count">{getMinimalisticDownloadCount()}</p>
                    </div>
                {/if}
            </div>
            {#if resourcePack?.description != undefined && resourcePack?.description != null}
                <p class="description">{resourcePack.description.length > 85 ? resourcePack.description.substring(0, 85) + '...' : resourcePack.description}</p>
            {/if}
        </div>
    </div>
    <div class="buttons">
        {#if resourcePack?.loading ?? false}
            <h1 class="required-button primary-text">
                LOADING
            </h1>
        {:else if text === "INSTALL"}
        {#if resourcePack?.featured}
            <div style="display: flex; flex-direction: column; align-items: center;">
                <h1 class="featured-label" style="margin-bottom: 15px;">
                    FEATURED
                </h1>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="install-button green-text" on:click={() => dispatch("install")}>
                    INSTALL
                </h1>
            </div>
        {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="install-button green-text" on:click={() => dispatch("install")}>
                INSTALL
            </h1>
        {/if}
        {:else if text === "INSTALLED"}
            {#if type == "RESULT"}
                <div style="display: flex; flex-direction: column; align-items: center;">
                    {#if resourcePack?.featured}
                        <h1 class="featured-label" style="margin-bottom: 15px;">
                            FEATURED
                        </h1>
                    {/if}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="red-text-clickable delete-button" style={type != "RESULT" ? "margin-top: 15px;" : ""} on:click={() => dispatch("delete")}>
                        DELETE
                    </h1>
                </div>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="red-text-clickable delete-button" style={type != "RESULT" ? "margin-top: 15px;" : ""} on:click={() => dispatch("delete")}>
                    DELETE
                </h1>
            {/if}
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
        gap: 0.5em;
        margin-top: 0.3em;
    }
    
    .blacklisted {
        border: 3.5px solid red;
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
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        color: var(--font-color);
        gap: 0.3em;
    }

    .href-wrapper .name-div {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.3em;
    }

    .text-item-wrapper {
        height: 100%;
        max-width: 400px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }

    .icon {
        width: 90px;
        height: 90px;
        object-fit: contain;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
        -webkit-user-drag: none;
    }

    .icon-fallback {
        background-image: url("https://docs.modrinth.com/img/logo.svg");
        min-width: 90px; 
        min-height: 90px;
        background-position: center center;
        background-size: 90%;
        background-repeat: no-repeat;
    }

    .resourcepack-title {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 16px;
        cursor: pointer;
        -webkit-user-drag: none;
    }

    .featured {
        font-size: 20px;
        padding-bottom: 10px;
    }

    .author-container {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 0.65em;
        margin-top: 0.3em;
    }

    .author-container .author {
        white-space: nowrap;
        font-family: 'Press Start 2P', serif;
        font-size: 9px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
    }

    .author-container .download-count {
        font-family: 'Press Start 2P', serif;
        font-size: 9px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
    }

    .description {
        font-family: 'Press Start 2P', serif;
        font-size: 9px;
        line-height: 1.2em;
        padding-top: 2em;
        cursor: default;
        text-shadow: 1px 1px var(--font-color-text-shadow);
    }

    .install-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .required-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: default;
    }

    .featured-label {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: #f0c91a;
        text-shadow: 1.5px 1.5px var(--hover-color-text-shadow);
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
