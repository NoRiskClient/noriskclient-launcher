<script>
    import {createEventDispatcher} from "svelte";
    import NRCLogo from "../../../images/norisk_logo.png";
    import { forceServer, setForceServer, runClient } from "../../../utils/noriskUtils.js";
    import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";

    const dispatch = createEventDispatcher()

    export let server;
</script>

<div class="server-item-wrapper">
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        <img class="icon" src={server.iconUrl != "" ? server.iconUrl : ''} alt="Shader Icon">
        <div class="text-item-wrapper">
            <div class="name-wrapper">
                <h4 class="server-name">{server.name}</h4>
                {#if server.supportsNoRiskClientFeatures}
                    <img src={NRCLogo} alt="NRC Logo" title="Supports special NoRiskClient features" style="-webkit-user-drag: none;">
                {/if}
            </div>
            <p>{server.description}</p>
        </div>
    </div>
    <div class="buttons">
        {#if $forceServer === `${server.name}:${server.ip}:${server.port}`}
            <h1 class="launching-button primary-text">LAUNCHING...</h1>
        {:else if $forceServer === `${server.name}:${server.ip}:${server.port}:LAUNCHED`}
            <h1 class="launching-button primary-text">PLAYING...</h1>
        {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="play-button  green-text" on:click={() => {
                    setForceServer(`${server.name}:${server.ip}:${server.port}`);
                    runClient($branches[$currentBranchIndex]);
                }}>
                PLAY
            </h1>
        {/if}
    </div>
</div>

<style>
    .server-item-wrapper {
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

    .name-wrapper {
        display: flex;
        align-items: center;
        gap: 0.7em;
    }

    .name-wrapper img {
        height: 27.5px;
        width: 27.5px;
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
        -webkit-user-drag: none;
    }

    .server-name {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 18px;
    }

    .server-item-wrapper p {
        width: 350px;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        line-height: 1.2em;
        padding-top: 2em;
    }

    .play-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .launching-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        margin-right: 1em;
    }

    .play-button:hover {
        transform: scale(1.2);
    }
</style>
