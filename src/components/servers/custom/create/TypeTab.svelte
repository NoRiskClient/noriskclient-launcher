<script>
    import {createEventDispatcher} from "svelte";
    import { translations } from '../../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let type;
    export let version;
    export let majorVersion;
    export let loaderVersion;
    export let availableTypes;
</script>

<div class="tab-wrapper">
    <h1 class="title">{lang.servers.custom.create.type.title}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="before-button" on:click={() => dispatch('back')}>&lt;-</h1>
    <div class="types row">
        {#each Object.values(availableTypes) as serverType}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="type row" class:active={type == serverType.type} on:click={() => {type = serverType.type; version = ""; majorVersion = ""; loaderVersion = "";}}>
                <img src={serverType.iconUrl} alt="Type Icon">
                <p>{serverType.name}</p>
            </div>
        {/each}
    </div>
    {#if type != ""}
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

    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .types {
        flex-wrap: wrap;
        justify-content: center;
    }

    .type {
        font-family: 'Press Start 2P', serif;
        gap: 1em;
        font-size: 14px;
        background-color: var(--background-contrast-color);
        width: min-content;
        padding: 20px;
        width: 200px;
        border-radius: 10px;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        text-wrap: nowrap;
        transition-duration: 200ms;
    }
    
    .type img {
        height: 35px;
    }

    .type.active {
        background-color: var(--secondary-color);
        transition-duration: 200ms;
    }
    
    .type:hover {
        transform: scale(1.1);
        transition-duration: 200ms;
    }

    .before-button {
        position: absolute;
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        text-align: center;
        cursor: pointer;
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

    .before-button:hover, .next-button:hover {
        transform: scale(1.2);
        transition-duration: 200ms;
    }
</style>