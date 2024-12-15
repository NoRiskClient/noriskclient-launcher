<script>
    import { invoke } from "@tauri-apps/api";
    import VirtualList from "../../../utils/VirtualList.svelte";
    import { createEventDispatcher } from "svelte";
    import { addNotification } from "../../../../stores/notificationStore.js";
    import { translations } from '../../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let type;
    export let availableTypes;
    export let version;
    export let loaderVersion;

    let version_keep;

    async function load() {
        if (type == "FABRIC" && availableTypes["FABRIC"].loaderVersions.length <= 0) {
            await invoke("get_all_fabric_loader_versions", { mcVersion: version }).then((response) => {
                const versions = response.map(r => r.loader);
                availableTypes["FABRIC"].loaderVersions = versions.map(v => v.version);
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get Fabric loader versions: " + error);
            });
        } else if (type == "QUILT" && availableTypes["QUILT"].loaderVersions.length <= 0) {
            if (availableTypes["QUILT"]?.loaders_manifest == null) return addNotification("How tf did that happen!?!?! Missing manifest that is usually required to get here...");
            const versions = availableTypes["QUILT"].loaders_manifest.loaders;
            availableTypes["QUILT"].loaderVersions = versions.map(v => v.id).filter(v => !v.includes('-') && v.includes('.'));
            availableTypes = availableTypes;
        } else if (type == "FORGE" && (availableTypes["FORGE"].loaderVersions.length <= 0 || version_keep != version)) {
            version_keep = version;
            availableTypes["FORGE"].loaderVersions = []; // reset if version changed
            if (availableTypes["FORGE"]?.loaders_manifest == null) return addNotification("How tf did that happen!?!?! Missing manifest that is usually required to get here...");
            const versions = availableTypes["FORGE"].loaders_manifest.find(v => v.id == version).loaders;
            availableTypes["FORGE"].loaderVersions = versions.map(v => v.id.split('-')[1]);
            availableTypes = availableTypes;
        } else if (type == "NEO_FORGE" && (availableTypes["NEO_FORGE"].loaderVersions.length <= 0 || version_keep != version)) {
            version_keep = version;
            availableTypes["NEO_FORGE"].loaderVersions = []; // reset if version changed
            if (availableTypes["NEO_FORGE"]?.loaders_manifest == null) return addNotification("How tf did that happen!?!?! Missing manifest that is usually required to get here...");
            const versions = availableTypes["NEO_FORGE"].loaders_manifest.find(v => v.id == version).loaders;
            availableTypes["NEO_FORGE"].loaderVersions = versions.map(v => v.id);
            availableTypes = availableTypes;
        }
    }

    load()
</script>

<div class="tab-wrapper">
    <h1 class="title">{lang.servers.custom.create.loaderVersion.title}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="before-button" on:click={() => dispatch('back')}>&lt;-</h1>
    <VirtualList height="28em" items={
        Array.from({ length: Math.ceil(availableTypes[type].loaderVersions.length / 3) }, (v, i) =>
            availableTypes[type].loaderVersions.slice(i * 3, i * 3 + 3) // split the versions into chucks of 3 to properly display them in the VirtualList
        )} let:item>
        <div class="versions row">
            {#each item as serverLoaderVersion}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class={`version row ${type.toLowerCase()}`} class:active={loaderVersion == serverLoaderVersion} on:click={() => loaderVersion = serverLoaderVersion}>
                    <p class:green-text={availableTypes[type].loaderVersions[0] == serverLoaderVersion} class:longName={(availableTypes[type].loaderVersions[0] == serverLoaderVersion ? 'Latest': serverLoaderVersion).length > 10}>{availableTypes[type].loaderVersions[0] == serverLoaderVersion ? 'Latest': serverLoaderVersion}</p>
                </div>
            {/each}
        </div>
    </VirtualList>
    {#if loaderVersion != null}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="next-button primary-text" on:click={() => dispatch('next')}>-&gt;</h1>
    {/if}
</div>

<style>
    .tab-wrapper {
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .title {
        font-size: 30px;
        text-align: center;
        margin-bottom: 1em;
        cursor: default;
    }

    .row {
        display: flex;
        flex-direction: row;
        gap: 1.5em;
    }

    h1 {
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .versions {
        justify-content: center;
        width: 100%;
        margin-top: 0.75em;
        margin-bottom: 0.75em;
    }

    .version {
            gap: 1em;
        background-color: var(--background-contrast-color);
        padding: 20px;
        border-radius: 10px;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        text-wrap: nowrap;
        transition-duration: 200ms;
    }

    .version.vanilla {
        width: 100px;
    }

    .version.fabric, .version.quilt {
        width: 200px;
    }

    .version.forge, .version.neo_forge {
        width: 200px;
    }

    .version.active {
        background-color: var(--secondary-color);
        transition-duration: 200ms;
    }

    .version .longName {
        font-size: 11px;
    }
    
    .version:hover {
        transform: scale(1.1);
        transition-duration: 200ms;
    }

    .before-button {
        position: absolute;
        font-size: 30px;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .next-button {
        position: absolute;
        font-size: 30px;
        margin-top: 60%;
        margin-left: 82.5%;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .before-button:hover, .next-button:hover {
        transform: scale(1.2);
        transition-duration: 200ms;
    }
</style>