<script>
    import {invoke} from "@tauri-apps/api";
    import TextInput from "../../../config/inputs/ConfigTextInput.svelte";
    import {createEventDispatcher} from "svelte";
    import { launcherOptions } from "../../../../stores/optionsStore.js";
    import { defaultUser } from "../../../../stores/credentialsStore.js";
    import { addNotification } from "../../../../stores/notificationStore.js";
    import { translations } from '../../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let name;
    export let icon;
    export let subdomain;
    export let baseDomain;

    async function next() {
        await invoke('check_custom_server_subdomain', {
            subdomain: subdomain,
            token: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
            uuid: $defaultUser.id
        }).then(() => {
            dispatch('next');
        }).catch((error) => {
            addNotification(lang.servers.custom.create.nameAndSubdomain.notification.failedToCheckSubdomain.replace("{error}", error));
        });
    }
</script>

<div class="tab-wrapper">
    <h1 class="title">{lang.servers.custom.create.nameAndSubdomain.title}</h1>
    <div class="row">
        <div class="column" style="width: 65%;">
            <TextInput bind:value={name} title={lang.servers.custom.create.nameAndSubdomain.tooltip.name} placeholder={lang.servers.custom.create.nameAndSubdomain.placeholder.name} autofocus={true} />
            <TextInput bind:value={subdomain} title={lang.servers.custom.create.nameAndSubdomain.tooltip.domain} placeholder={lang.servers.custom.create.nameAndSubdomain.placeholder.subdomain} suffix={`.${baseDomain}`} />
        </div>
        <div class="column" style="gap: 0em;">
            <h1>Icon</h1>
            <img src={icon} alt="Server Icon">
            <h1 class="edit-icon" class:edit-mode={icon == null}>✏️</h1>
        </div>
    </div>
    {#if name.length > 0 && subdomain.length > 0}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="next-button primary-text" on:click={next}>-&gt;</h1>
    {/if}
</div>

<style>
    .tab-wrapper {
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .title {
        font-family: 'Press Start 2P', serif;
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

    .column {
        display: flex;
        flex-direction: column;
        gap: 3em;
    }

    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    img {
        height: 200px;
        width: 200px;
        background-color: var(--background-contrast-color);
        border-radius: 10px;
    }

    .edit-icon {
        position: absolute;
        height: 200px;
        width: 200px;
        text-align: center;
        padding-top: 70px;
        margin-top: 32.5px;
        font-size: 40px;
        opacity: 0%;
        cursor: pointer;
        transition-duration: 200ms;
    }

    
    .edit-icon:hover, .edit-icon.edit-mode:hover {
        background-color: var(--background-contrast-color);
        font-size: 50px;
        opacity: 100%;
        border-radius: 10px;
        padding-top: 60px;
        transition-duration: 200ms;
    }

    .edit-icon.edit-mode {
        padding-top: 70px;
        font-size: 40px;
        background-color: var(--background-contrast-color);
        border-radius: 10px;
        opacity: 100%;
        transition-duration: 200ms;
    }

    .next-button {
        position: absolute;
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        margin-top: 60%;
        margin-left: 82.5%;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .next-button:hover {
        transform: scale(1.2);
        transition-duration: 200ms;
    }
</style>