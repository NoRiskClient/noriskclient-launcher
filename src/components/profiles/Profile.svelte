<script>
    import {createEventDispatcher} from "svelte";
    import { translations } from '../../utils/translationUtils.js';
    import { launcherOptions } from "../../stores/optionsStore.js";
    import CloneIconDark from '../../images/clone_icon_dark.png';
    import CloneIconWhite from '../../images/clone_icon_white.png';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let profile;
    export let active;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="profile-item-wrapper" class:enabled={active}>
    <div class="text-wrapper" on:click={() => dispatch('select')}>
        <h2>{profile.name.length > 20 && profile.name != `${profile.branch} - Default` ? profile.name.substring(0, 18) + '...' : profile.name}</h2>
        <h2 style={profile.name == `${profile.branch} - Default` ? 'margin-left: 4em;' : 'margin-left: 2em;'}>({profile.mods.filter(mod => !mod.value.source.artifact.includes("PLACEHOLDER")).length} Mods)</h2>
    </div>
    <div class="button-wrapper">
        <div class="clone-click" on:click={() => dispatch('clone')}></div>
        <img class="clone-button" src={$launcherOptions.theme == "DARK" ? CloneIconWhite : CloneIconDark} alt="Clone" >
        <h1 class="export-button" title="Export" on:click={() => dispatch('export')}>📤</h1>
        {#if profile.name != `${profile.branch} - Default`}
            <h1 class="settings-button" title={lang.profiles.profile.tooltip.editProfile} on:click={() => dispatch('settings')}>
                ⚙️
            </h1>
        {:else}
            <h1 class="default-info" title={lang.profiles.profile.tooltip.defaultProfile}>
                📌
            </h1>
        {/if}
    </div>
</div>

<style>
    .profile-item-wrapper {
        display: flex;
        width: 60em;
        font-size: 10px;
        font-weight: 300;
        border-radius: 7.5px;
        background-color: var(--background-contrast-color);
        border: 1.5px solid var(--background-contrast-color);
        align-items: center;
        justify-content: space-between;
        gap: 1em;
        margin-top: 1em;
        justify-content: space-between;
    }
    
    .text-wrapper {
        display: flex;
        flex-direction: row;
        padding: 2em;
        height: 100%;
        width: 100%;
    }

    .text-wrapper h2:nth-child(2) {
        align-self: flex-end;
    }

    .enabled {
        border-color: rgba(0, 255, 0, 0.5);
    }

    .button-wrapper {
        display: flex;
        flex-direction: row;
        gap: 2.5em;
        padding-right: 2em;
        justify-content: space-between;
    }

    .export-button {
        cursor: pointer;
        margin-bottom: 3px;
        transition-duration: 100ms;
    }

    .export-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }

    .settings-button {
        cursor: pointer;
        margin-bottom: 3px;
        transition-duration: 100ms;
    }

    .settings-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }

    .default-info {
        cursor: default;
        font-weight: 200;
        font-size: 20px;
    }
    
    .clone-button {
        cursor: pointer;
        height: 20px;
        width: 20px;
        align-self: center;
        transition-duration: 100ms;
    }

    .clone-click:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }

    .clone-click {
        position: absolute;
        height: 20px;
        width: 20px;
        cursor: pointer;
    }
</style>
