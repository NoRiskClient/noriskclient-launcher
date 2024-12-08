<script>
    import {createEventDispatcher} from "svelte";
    import ConfigRadioButton from "../../../config/inputs/ConfigRadioButton.svelte";
    import { translations } from '../../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let eula;
</script>

<div class="tab-wrapper">
    <h1 class="title">{lang.servers.custom.create.eula.title}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="before-button" on:click={() => dispatch('back')}>&lt;-</h1>
    <div class="column content">
        <!-- Please appreciate the following ~~mess~~ -> masterpiece -->
        <p class="eula-text">{@html lang.servers.custom.create.eula.text.replace("{eula}", `<a class="primary-text" href="https://www.minecraft.net/en-us/eula" target="_blank" title="${lang.servers.custom.create.eula.tooltip.eulaLink}">${lang.servers.custom.create.eula.eulaLink}</a>`)}</p>
        <ConfigRadioButton bind:value={eula} text="" />
    </div>
    {#if eula == true}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="next-button primary-text" on:click={() => dispatch('next')}>{lang.servers.custom.create.eula.button.finish}</h1>
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

    .column {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 1.5em;
    }

    .content {
        margin-top: 6em;
    }

    h1 {
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    p {
        font-size: 14px;
        margin-bottom: 0.8em;
        cursor: default;
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
        margin-left: 65%;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .before-button:hover, .next-button:hover {
        transform: scale(1.2);
        transition-duration: 200ms;
    }
</style>