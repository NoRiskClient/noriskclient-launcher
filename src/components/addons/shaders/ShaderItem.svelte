<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let shader;
    export let text;
    export let type;
</script>

<div class="shader-item-wrapper" class:blacklisted={shader?.blacklisted}>
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        {#if type != 'CUSTOM'}
            <img class="icon" src={shader.icon_url} alt="Shader Icon">
        {:else}
            <div class="custom-shader-icon">🔮</div>
        {/if}
        <div class="text-item-wrapper">
            <div class="href-wrapper">
                {#if type != 'CUSTOM'}
                    <a class="shader-title" href={"https://modrinth.com/shader/"+shader.slug} target="_blank" title="Modrinth Page">
                        {shader.title}
                    </a>
                    {#if shader?.featured}
                        <p title="Featured" style="font-size: 20px;">⭐️</p>
                    {/if}
                {:else}
                    <!-- svelte-ignore a11y-missing-attribute -->
                    <a class="shader-title">{shader.replace('.zip', '')}</a>
                {/if}
                {#if shader?.author != undefined && shader?.author != null}
                    <div>by {shader.author}</div>
                {/if}
            </div>
            {#if shader?.description != undefined && shader?.description != null}
                <p>{shader.description}</p>
            {/if}
        </div>
    </div>
    <div class="buttons">
        {#if shader?.loading ?? false}
            <h1 class="required-button">
                LOADING
            </h1>
        {:else if text === "INSTALL"}
            {#if shader?.featured}
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <h1 class="featured-label" style="margin-bottom: 15px;">
                        FEATURED
                    </h1>
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="install-button" on:click={() => dispatch("install")}>
                        INSTALL
                    </h1>
                </div>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="install-button" on:click={() => dispatch("install")}>
                    INSTALL
                </h1>
            {/if}
        {:else if text === "INSTALLED"}
            {#if type == "RESULT"}
                <div style="display: flex; flex-direction: column; align-items: center;">
                    {#if shader?.featured}
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
    .shader-item-wrapper {
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
    
    .custom-shader-icon {
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
        object-fit: contain;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
    }

    .shader-title {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 18px;
        cursor: pointer;
    }

    .shader-item-wrapper p {
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

    .featured-label {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: #f0c91a;
        text-shadow: 1.5px 1.5px var(--hover-color-text-shadow);
        cursor: default;
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
