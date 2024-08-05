<script>
    import { invoke } from "@tauri-apps/api/core";
    import VirtualList from "../../utils/VirtualList.svelte";
    import CustomServerInfoPopup from "./CustomServerInfoPopup.svelte";
    import {createEventDispatcher} from "svelte";
    import { customServerLogs, clearCustomServerLogs } from "../../../stores/customServerLogsStore.js";
    import { launcherOptions } from "../../../stores/optionsStore.js";
    import { customServers, activeCustomServerId } from "../../../stores/customServerStore.js";
    import { defaultUser } from "../../../stores/credentialsStore.js";

    const dispatch = createEventDispatcher()

    let customServer = $customServers.find(s => s._id == $activeCustomServerId) ?? {};

    if (customServer._id == undefined) {
        alert("Failed to load custom server details.");
    }

    console.log($customServerLogs);

    let logs = $customServerLogs[customServer._id] ?? [];

    customServerLogs.subscribe(value => {
        logs = value[customServer._id] ?? [];
    });

    let showInfoPopup = false;

    async function runServer() {
        await invoke("run_custom_server", {
            customServer: customServer,
            options: $launcherOptions,
            token: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
            uuid: $defaultUser.id
        }).then(() => {
            console.log("YAY!");
        }).catch((error) => {
            console.error(error);
            alert(error);
        });
    }

    async function stopServer() {
        await invoke("terminate_custom_server").then(() => {
            clearCustomServerLogs(customServer._id);
            console.log("YAY!");
        }).catch((error) => {
            console.error(error);
            alert(error);
        });
    }
</script>

{#if showInfoPopup}
    <CustomServerInfoPopup bind:customServer={customServer} bind:showModal={showInfoPopup} />
{/if}
<div class="create-server-wrapper">
    <div class="row">
        <div class="row">
            <h1>Status:</h1>
            {#if logs.length < 1}
                <h1 class="offline">Offline</h1>
            {:else if logs.join(' ').includes('Done')}
                <h1 class="online">Running</h1>
            {:else}
                <h1 class="starting">Starting...</h1>
            {/if}
        </div>
        <div class="start-stop-button-wrapper">
            {#if logs.length < 1}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="startServer-button" on:click={runServer}>Start</h1>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="stopServer-button" on:click={stopServer}>Stop</h1>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="stopServer-button" on:click={stopServer}>Stop</h1>
            {/if}
        </div>
    </div>
    <div class="row">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="detailsButton" on:click={() => showInfoPopup = true}>Infos</h1>
        {#if ["FABRIC", "FORGE", "QUILT", "NEO_FORGE"].includes(customServer.type.toUpperCase())}
            <h1 class="detailsButton">Mods</h1>
        {/if}
    </div>
    {#if logs.length > 0}
        <VirtualList items={logs} height="27.5em" autoScroll={true} let:item>
            {#if item.startsWith('[')}
                <div class="logRow">
                    <p class="timestamp">{item.split(' ')[0]}</p>
                    <p class={`${item.split('/')[1].split(']: ')[0]}`}>{item.split('/')[1].split(']: ')[0]}</p>
                    <p>{item.split(']: ').slice(1).join(']: ')}</p>
                </div>
            {:else}
                <p>{item}</p>
            {/if}
        </VirtualList>
    {:else}
        <h1 class="center">No logs available...<br>Server is offline.</h1>
    {/if}
</div>

<style>
    .create-server-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        margin: 1em;
        gap: 0.7em;
    }

    p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        text-shadow: none;
        margin-bottom: 5px;
        line-height: 20px;
        cursor: default;
    }

    .row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        gap: 1.5em;
    }

    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .online {
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
    }

    .starting {
        color: #ff9100;
        text-shadow: 2px 2px #d67900;
    }

    .offline {
        color: #ff0000;
        text-shadow: 2px 2px #a80000;
    }

    .center {
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        text-align: center;
        margin-top: 25%;
        line-height: 30px;
    }

    .start-stop-button-wrapper {
        margin-right: 2em;
        text-align: right;
    }

    .startServer-button {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .startServer-button:hover {
        transform: scale(1.2);
    }

    .stopServer-button {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: #ff0000;
        text-shadow: 2px 2px #a80000;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .stopServer-button:hover {
        transform: scale(1.2);
    }

    .detailsButton {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: pointer;
        transition: transform 0.3s;
    }

    .detailsButton:hover {
        transform: scale(1.2);
    }

    .logRow {
        display: flex;
        flex-direction: row;
        gap: 1em;
    }

    .timestamp {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #868080;
        text-shadow: none;
    }

    .INFO {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: var(--primary-color);
        text-shadow: none;
    }

    .WARN {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #ff9100;
        text-shadow: none;
    }

    .ERROR {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #ff0000;
        text-shadow: none;
    }
</style>
