<script>
    import { createEventDispatcher } from "svelte";
    import { onMount, tick } from "svelte";
    import { openInfoPopup } from "../../../utils/popupUtils.js";
    import FallbackIcon from "/src/images/modrinth.png";
    import { translations } from '../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let mod;
    export let enabled = mod?.value?.enabled ?? null;
    export let text;
    export let type;
    export let modVersions;

    const slug = mod?.slug ?? mod?.value?.source?.artifact?.split(":")[1];
    const name = mod?.title ?? mod?.value?.name;

    let versionDropdownOpen = false;
    let isChangingVersion = false;

    onMount(() => {
        isChangingVersion = false;
        if (slug && text != "DEPENDENCY" && modVersions != null && modVersions[slug] == null) {
            console.log("Fetching versions for " + name);
            dispatch("getVersions");
        }
    })

    async function changeVersion(version) {
        console.log("Changing version of " + slug + " to " + version);
        isChangingVersion = true;
        versionDropdownOpen = false;
        await dispatch("changeVersion", { version: version });
    }

    function getMinimalisticDownloadCount() {
        if (mod?.downloads < 1000) {
            return mod?.downloads;
        } else if (mod?.downloads < 1000000) {
            return lang.addons.global.item.downloadCount.thousand.replace("{count}", (mod?.downloads / 1000).toFixed(1));
        } else {
            return lang.addons.global.item.downloadCount.million.replace("{count}", (mod?.downloads / 1000000).toFixed(1));
        }
    }
</script>

<div class="mod-item-wrapper" class:blacklisted={mod?.blacklisted}>
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        {#if type != 'CUSTOM'}
            <img class="icon" src={mod.icon_url ?? mod.image_url} alt=" " onerror="this.src='{FallbackIcon}'">
        {:else}
            <div class="custom-mod-icon">📦</div>
        {/if}
        <div class="text-item-wrapper" style={type != "INSTALLED" && type != "CUSTOM" ? 'height: 95px;' : ''}>
            <div class="href-wrapper">
                {#if type != 'CUSTOM'}
                    <div class="name-div">
                        <a class="mod-title" href={(mod?.value?.source?.artifact?.includes("modrinth") || mod?.downloads) ? `https://modrinth.com/mod/${slug}` : undefined} target="_blank" title={name}>
                            {name.length > 20 && (text == 'INSTALL' || text == 'REQUIRED' || text == 'DEPENDENCY') ? name.substring(0, 19) + '...' : name}
                        </a>
                        {#if mod?.featured}
                            <p title="Featured">⭐️</p>
                        {/if}
                    </div>
                {:else}
                    <!-- svelte-ignore a11y-missing-attribute -->
                    <a class="mod-title">{mod.title.replace('.jar', '')}</a>
                {/if}
                {#if mod?.author != undefined && mod?.author != null}
                    <div class="author-container">
                        <p class="author">{lang.addons.global.item.madeBy.replace("{author}", mod.author ?? mod.value.author)}</p>
                        {#if mod?.downloads != null}
                            <b>•</b>
                            <p class="download-count">{getMinimalisticDownloadCount()}</p>
                        {/if}
                    </div>
                {/if}
            </div>
            {#if mod.isMissing}
                <p class="description isMissing red-text"><span style="text-shadow: none; font-size: 20px;">⚠️</span> {lang.addons.mods.item.fileDoesNotExist}</p>
            {:else if type == "CUSTOM"}
                <p class="description custom-mod-label">{lang.addons.mods.item.customModDescription}</p>
            {:else if mod.parents != undefined && mod.parents.length > 0}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <p
                    class="description"
                    style="margin-top: 1em; opacity: 0.65;"
                    on:click={
                        mod.parents.join(", ").length > 180 ? () => openInfoPopup({
                            title: lang.addons.mods.item.dependencyText.popup.title,
                            content: mod.parents.join(", "),
                            contentFontSize: "14px"
                        }) : () => {}
                    }>
                
                    {lang.addons.mods.item.dependencyText.usedBy.replace("{parents}", mod.parents.length > 180 ? mod.parents.join(", ").substring(0, 180) + "..." : mod.parents.join(", "))}
                </p>
            {:else if mod.description != undefined && mod.description != null}
                <p class="description">{mod.description.length > 85 ? mod.description.substring(0, 85) + '...' : mod.description}</p>
            {:else if modVersions != null && modVersions[slug]?.length > 1}
                <div class="versionSelect">
                    <p>Version:</p>
                    <section class="dropdown">
                        <button
                            on:click={async () => {
                                if (isChangingVersion) return;
                                versionDropdownOpen = !versionDropdownOpen;
                                await tick();
                            }}
                        >
                            {#if isChangingVersion}
                                <span>⏳</span> {lang.addons.mods.item.changingVersion}
                            {:else}
                                <span>{versionDropdownOpen ? '⮟' : '⮞'} </span> {mod?.value?.source?.artifact?.split(':')[2]}
                            {/if}
                        </button>
                        <div class="versions" class:show={versionDropdownOpen}>
                            {#each modVersions[slug].filter(v => v != mod?.value?.source?.artifact?.split(':')[2]) as version}
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <p class="version" on:click={() => changeVersion(version)}>{version}</p>
                            {/each}
                        </div>
                    </section>
                </div>
            {/if}
        </div>
    </div>
    <div class="buttons">
        {#if mod?.loading ?? false}
            <h1 class="required-button primary-text">
                {lang.addons.global.item.loading}
            </h1>
        {:else if text === "INSTALL"}
            {#if mod?.featured}
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <h1 class="featured-label" style="margin-bottom: 15px;">
                        {lang.addons.global.item.featured}
                    </h1>
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="install-button green-text" on:click={() => dispatch("install")}>
                        {lang.addons.global.item.button.install}
                    </h1>
                </div>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="install-button green-text" on:click={() => dispatch("install")}>
                    {lang.addons.global.item.button.install}
                </h1>
            {/if}
        {:else if text === "RECOMMENDED"}
            <div style="display: flex; flex-direction: column; align-items: center;">
                <h1 class="required-button primary-text" style="margin-bottom: 15px;">
                    {lang.addons.mods.item.recommended}
                </h1>
                {#if enabled}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="red-text-clickable delete-button" on:click={() => dispatch("disable")}>
                        {lang.addons.global.item.button.disable}
                    </h1>
                {:else}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="green-text-clickable install-button" on:click={() => dispatch("enable")}>
                        {lang.addons.global.item.button.enable}
                    </h1>
                {/if}
            </div>
        {:else if text === "INSTALLED"}
            {#if type == "RESULT"}
                <div style="display: flex; flex-direction: column; align-items: center;">
                    {#if mod?.featured}
                        <h1 class="featured-label" style="margin-bottom: 15px;">
                            {lang.addons.global.item.featured}
                        </h1>
                    {/if}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="red-text-clickable delete-button" style={type != "RESULT" ? "margin-top: 15px;" : ""} on:click={() => dispatch("delete")}>
                        {lang.addons.global.item.button.delete}
                    </h1>
                </div>
            {:else}
                {#if enabled}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="red-text-clickable delete-button" on:click={() => dispatch("toggle")}>
                        {lang.addons.global.item.button.disable}
                    </h1>
                {:else}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="green-text-clickable install-button" on:click={() => dispatch("toggle")}>
                        {lang.addons.global.item.button.enable}
                    </h1>
                {/if}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="red-text-clickable delete-button" style={type != "RESULT" ? "margin-top: 15px;" : ""} on:click={() => dispatch("delete")}>
                    {lang.addons.global.item.button.delete}
                </h1>
            {/if}
        {:else if text === "REQUIRED"}
            <h1 class="required-button primary-text">
                {lang.addons.mods.item.required}
            </h1>
        {:else if text === "DEPENDENCY"}
            <h1 class="required-button primary-text">
                {lang.addons.mods.item.dependency}
            </h1>
        {:else if type == "CUSTOM"}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            {#if enabled}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="red-text-clickable delete-button" on:click={() => dispatch("toggle")}>
                    {lang.addons.global.item.button.disable}
                </h1>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="green-text-clickable install-button" on:click={() => dispatch("toggle")}>
                    {lang.addons.global.item.button.enable}
                </h1>
            {/if}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="red-text-clickable delete-button" style="margin-top: 15px;" on:click={() => dispatch("delete")}>
                {lang.addons.global.item.button.delete}
            </h1>
        {/if}
    </div>
</div>

<style>
    .mod-item-wrapper {
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
    }

    .blacklisted {
        border: 3.5px solid red;
    }

    .buttons {
        margin-right: 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
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
    
    .custom-mod-icon {
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
        max-width: 400px;
        overflow: hidden;
    }

    .icon {
        width: 90px;
        height: 90px;
        object-fit: contain;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
        -webkit-user-drag: none;
    }

    .mod-title {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 16px;
        cursor: pointer;
        -webkit-user-drag: none;
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

    .custom-mod-label {
        font-size: 14px !important;
        font-style: italic;
        opacity: 0.5;
    }

    .description {
        font-family: 'Press Start 2P', serif;
        font-size: 9px;
        line-height: 1.2em;
        padding-top: 2em;
        cursor: default;
        text-shadow: 1px 1px var(--font-color-text-shadow);
    }

    .versionSelect {
        display: flex;
        flex-direction: column;
        align-items: start;
        justify-content: center;
        margin-top: 1.5em;
        gap: 0.5em;
    }

    .versionSelect p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        text-shadow: 1px 1px var(--font-color-text-shadow);
    }

    .versionSelect button {
        display: flex;
        font-family: 'Press Start 2P', serif;
        font-size: 11px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
        cursor: pointer;
        background: var(--background-color);
        border: none;
        border-radius: 5px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1em;
    }

    .versionSelect button span {
        font-size: 12px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
    }

    .versionSelect .dropdown {
        display: inline-block;
    }

    .versionSelect .dropdown .versions {
      display: none;
      flex-direction: column;
      gap: 1.5em;
      position: absolute;
      background-color: var(--background-color);
      padding: 15px 15px 15px 1.5em;
      margin-top: 5px;
      border: none;
      border-radius: 5px;
      z-index: 100;
    }

    .versionSelect .dropdown .versions.show {
        display: flex;
    }

    .versionSelect .dropdown .versions .version {
        font-family: 'Press Start 2P', serif;
        font-size: 12px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
        cursor: pointer;
    }

    .versionSelect .dropdown .versions .version:hover {
        text-decoration: underline;
        color: var(--primary-color);
        text-shadow: 1.5px 1.5px var(--primary-color-text-shadow);
    }

    .isMissing {
        font-size: 14px;
        font-style: italic;
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
        text-shadow: 1.5px 1.5px #9e8704;
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
