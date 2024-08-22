<script>
	import { onMount } from 'svelte';
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
    let serverRunning = logs.join(' ').includes('Done') && !logs.join(' ').includes('Stopping server');
    let consoleListenerActive = false;
    let liveServerInfo;
    let currentTab = 0;

    customServerLogs.subscribe(value => {
        logs = value[customServer._id] ?? [];
        let before = serverRunning;
        serverRunning = logs.join(' ').includes('Done') && !logs.join(' ').includes('Stopping server');
        if (serverRunning && serverRunning != before) {
            getRconServerInfo();
        }
        if (serverRunning && !consoleListenerActive) {
            consoleListenerActive = true;
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
            invoke("execute_rcon_command", {
                serverId: customServer._id,
                timestamp: getCurrentTimestamp(),
                logType: "CONSOLE",
                command: command,
            }).catch((error) => {
                addNotification("Failed to send command: " + error);
            });
        });
    }

    function getRconServerInfo() {
        invoke("get_rcon_server_info").then(info => {
            console.log(info);
            liveServerInfo = {
                seed: info['seed'].split(': [')[1].replace(']', ''),
                difficulty: info['difficulty'].split(' ')[3],
                maxPlayers: parseInt(info['list'].split(' ')[7]),
                onlinePlayers: info['list'].split(': ')[1].split(', ').filter(p => p != ''),
                whitelistedPlayers: info['whitelist'].split(': ').length >= 2 ? info['whitelist'].split(': ')[1].split(', ') : [],
            };
            
            // liveServerInfo = info;
        }).catch((error) => {
            addNotification("Failed to get server info: " + error);
        });
    }

    function getCurrentTimestamp() {
        const date = new Date();
        return `[${date.getHours() < 10 ? "0" + date.getHours() : date.getHours()}:${date.getMinutes() < 9 ? "0" + date.getMinutes() : date.getMinutes()}:${date.getSeconds() < 9 ? "0" + date.getSeconds() : date.getSeconds()}]`;
    }

    let showInfoPopup = false;

    async function runServer() {
        consoleListenerActive = false;
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
            launcherWasClosed: $stillRunningCustomServer == customServer._id,
        }).catch((error) => {
            addNotification("Failed to stop server: " + error);
        });
    }

    onMount(() => {
        if (serverRunning) {
            getRconServerInfo();
            addConsoleListener();
        }

        setInterval(() => {
            if (!serverRunning) { return; }
            getRconServerInfo();
        }, 10 * 1000);

        if ($stillRunningCustomServer == customServer._id) {
            addNotification("Live logs unavailable. | Click for more info!", "INFO", "Live logs are currently unavailable because you closed the launcher while your server was still running.", 5000);
        }
    });
</script>

{#if showInfoPopup}
    <CustomServerInfoPopup bind:customServer={customServer} bind:showModal={showInfoPopup} />
{/if}
<div class="server-details-wrapper">
    <div class="row" style="margin-top: 0.5em;">
        <div class="row" style="margin-left: 0.5em;">
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
    <hr>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="navbar">
        <p class="navItem" class:active={currentTab == 0} on:click={() => currentTab = 0}>Logs</p>
        <p class="navItem" class:active={currentTab == 1} on:click={() => currentTab = 1}>Overview</p>
        <p class="navItem" class:active={currentTab == 2} on:click={() => currentTab = 2}>Addons</p>
    </div>
    <div class="content">
        {#if currentTab == 0}
            {#if logs.length > 0}
                <VirtualList items={logs} height="24.5em" autoScroll={true} let:item>
                    {#if item.startsWith('[')}
                        <div class="logRow">
                            <p class="timestamp">{item.split(' ')[0]}</p>
                            <p class={`${item.split('/')[1].split(']: ')[0]}`}>{item.split('/')[1].split(']: ')[0]}</p>
                            <p>{item.split(']: ').slice(1).join(']: ')}</p>
                        </div>
                    {:else}
                        <div class="logRow">
                            <p class="timestamp">{getCurrentTimestamp()}</p>
                            <p class="INFO">LOG</p>
                            <p>{item}</p>
                        </div>
                    {/if}
                </VirtualList>
            {:else}
                <h1 class="center">No logs available...<br>Server is offline.</h1>
            {/if}
        {:else if currentTab == 1}
            <div class="row overview">
                <div class="infos">
                    <div class="item">
                        <p>Name:</p>
                        <p>{customServer.name}</p>
                    </div>
                    <div class="item">
                        <p>Subdomain:</p>
                        <p class="small" title={`${customServer.subdomain}.${customServer.domain}`}>{customServer.subdomain}</p>
                    </div>
                    <div class="item">
                        <p>Version:</p>
                        <p>{customServer.mcVersion}</p>
                    </div>
                    <div class="item">
                        <p>Type:</p>
                        <p>{customServer.type}</p>
                    </div>
                    {#if liveServerInfo}
                        <div class="item">
                            <p>Seed:</p>
                            <p class="small">{liveServerInfo['seed']}</p>
                        </div>
                        <div class="item">
                            <p>Difficulty:</p>
                            <p>{liveServerInfo['difficulty']}</p>
                        </div>
                        <div class="item">
                            <p>Max Players:</p>
                            <p>{liveServerInfo['maxPlayers']}</p>
                        </div>
                        {#if serverRunning}
                            <div class="item">
                                <p>Online Players:</p>
                                <p>{liveServerInfo['onlinePlayers'].length ?? 0}</p>
                            </div>
                        {/if}
                        <div class="item">
                            <p>Whitelisted Players:</p>
                            <p>{liveServerInfo['whitelistedPlayers'].length ?? 0}</p>
                        </div>
                    {/if}
                </div>
            </div>
        {:else if currentTab == 2}
            <h1 class="center">Coming soon...</h1>
        {/if}
    </div>
    <!-- Keep this here so the eventlistener doesnt die on tab switch -->
    {#if serverRunning}
        <form id="console-form">
            <input class="console" type="text" placeholder="Enter a command and press enter to execute..." hidden={!serverRunning || currentTab != 0}>
        </form>
    {/if}
</div>

<style>
    .server-details-wrapper {
        width: 100vw;
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 1em;
        gap: 0.7em;
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

    .navbar {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding: 0em 5em;
        height: 3em;
        gap: 2em;
    }

    .navbar p {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        padding: 10px;
        cursor: pointer;
        transition-duration: 300ms;
    }

    .navbar p.active {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .navbar p:hover {
        transform: scale(1.2);
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
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
        margin-right: 0.5em;
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

    .logRow {
        display: flex;
        flex-direction: row;
        width: 95vw;
        overflow: hidden;
        gap: 1em;
    }

    .logRow p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        text-shadow: none;
        margin-bottom: 5px;
        line-height: 20px;
        cursor: default;
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
        width: 99%;
        outline: none;
        text-shadow: none;
        transition: background-color 0.3s ease-in-out;
    }
    .console::placeholder {
        color: var(--font-color);
        opacity: 0.65;
    }

    .overview {
        display: flex;
        flex-direction: row;
        margin-top: 1em;
        gap: 1em;
    }

    .overview .infos {
        display: flex;
        flex-direction: column;
        gap: 0.75em;
        width: 40vw;
        margin-left: 2vw;
    }

    .overview .infos .item {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
    }

    .overview .infos .item p {
        font-family: 'Press Start 2P', serif;
        font-size: 13.5px;
        margin-bottom: 0.8em;
        cursor: default;
    }
    
    .overview .infos .item p.small {
        font-size: 11px;
        text-shadow: 1.5px 1.5px var(--font-color-text-shadow);
    }
</style>
