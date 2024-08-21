<script>
    import { invoke } from "@tauri-apps/api";
    import { pop } from "svelte-spa-router";
    import VirtualList from "../../utils/VirtualList.svelte";
    import CustomServerInfoPopup from "./CustomServerInfoPopup.svelte";
    import { customServerLogs, clearCustomServerLogs } from "../../../stores/customServerLogsStore.js";
    import { launcherOptions } from "../../../stores/optionsStore.js";
    import { customServers, activeCustomServerId } from "../../../stores/customServerStore.js";
    import { clearStillRunningCustomServer, stillRunningCustomServer } from "../../../stores/customServerLogsStore.js";
    import { getNoRiskToken } from "../../../utils/noriskUtils.js";
    import { defaultUser } from "../../../stores/credentialsStore.js";
    import { addNotification } from "../../../stores/notificationStore.js";

    let customServer = $customServers.find(s => s._id == $activeCustomServerId) ?? {};

    if (customServer._id == undefined) {
        pop();
        pop();
        addNotification("Failed to load custom server details.");
    }

    let logs = $customServerLogs[customServer._id] ?? [];
    let showConsole = false;

    customServerLogs.subscribe(value => {
        logs = value[customServer._id] ?? [];
        if (logs.length > 0 && !showConsole) {
            showConsole = true;
            setTimeout(() => {
                addConsoleListener();
            }, 100);
        } else if (logs.find(log => log.includes("Thread RCON Listener stopped"))) {
            clearCustomServerLogs(customServer._id);
            clearStillRunningCustomServer();
        }
    });

    function addConsoleListener() {
        const form = document.getElementById("console-form");
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const input = form.querySelector("input");
            let command = input.value;
            if (command == "") return;
            if (command.startsWith("/")) {
                command = command.substring(1);
            }
            input.value = "";
            const date = new Date();
            const timestamp = `[${date.getHours() < 10 ? "0" + date.getHours() : date.getHours()}:${date.getMinutes() < 9 ? "0" + date.getMinutes() : date.getMinutes()}:${date.getSeconds() < 9 ? "0" + date.getSeconds() : date.getSeconds()}]`;
            invoke("execute_rcon_command", {
                serverId: customServer._id,
                timestamp: timestamp,
                logType: "CONSOLE",
                command: command,
            }).catch((error) => {
                addNotification("Failed to send command: " + error);
            });
        });
    }

    let showInfoPopup = false;

    async function runServer() {
        showConsole = false;
        await invoke("run_custom_server", {
            customServer: customServer,
            options: $launcherOptions,
            token: getNoRiskToken(),
            uuid: $defaultUser.id
        }).catch((error) => {
            addNotification("Failed to start server: " + error);
        });
    }

    async function stopServer() {
        await invoke("terminate_custom_server", {
            options: $launcherOptions,
        }).catch((error) => {
            addNotification("Failed to stop server: " + error);
        });
    }

    if ($stillRunningCustomServer == customServer._id) {
        addNotification("Live logs unavailable. | Click for more info!", "INFO", "Live logs are currently unavailable because you closed the launcher while your server was still running.", 5000);
    }
</script>

{#if showInfoPopup}
    <CustomServerInfoPopup bind:customServer={customServer} bind:showModal={showInfoPopup} />
{/if}
<div class="server-details-wrapper">
    <div class="row">
        <div class="row">
            <h1>Status:</h1>
            {#if logs.length < 1}
                <h1 class="offline">Offline</h1>
            {:else if logs.join(' ').includes('Done')}
                <h1 class="online green-text">Running</h1>
            {:else if logs.join(' ').includes('Stopping server')}
                <h1 class="stopping">Stopping...</h1>
            {:else}
                <h1 class="starting">Starting...</h1>
            {/if}
        </div>
        <div class="start-stop-button-wrapper">
            {#if logs.length < 1}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="startServer-button green-text" on:click={runServer}>Start</h1>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="stopServer-button red-text" on:click={stopServer}>Stop</h1>
            {/if}
        </div>
    </div>
    <div class="row">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="detailsButton" on:click={() => showInfoPopup = true}>Infos</h1>
        {#if ["FABRIC", "FORGE", "QUILT", "NEO_FORGE"].includes(customServer?.type?.toUpperCase())}
            <h1 class="detailsButton">Mods</h1>
        {/if}
    </div>
    {#if logs.length > 0}
        <VirtualList items={logs} height="26.5em" autoScroll={true} let:item>
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
    {#if logs.length > 0 && showConsole}
        <form id="console-form">
            <input class="console" type="text" placeholder="Enter a command and press enter to execute...">
        </form>
    {/if}
</div>

<style>
    .server-details-wrapper {
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

    .starting {
        color: #ff9100;
        text-shadow: 2px 2px #d67900;
    }

    .stopping {
        color: #ff7300;
        text-shadow: 2px 2px #d66000;
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
        width: 95vw;
        overflow: hidden;
        gap: 1em;
    }

    .logRow p:nth-child(3) {
        line-break: anywhere;
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

    .CONSOLE {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #ffcd2b;
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

    .console {
        border-radius: 5px;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        padding: 6px 8px;
        border: 1px solid #212121;
        background-color: var(--background-contrast-color);
        width: 96%;
        outline: none;
        text-shadow: none;
        transition: background-color 0.3s ease-in-out;
    }
    .console::placeholder {
        color: var(--font-color);
        opacity: 0.65;
    }
</style>
