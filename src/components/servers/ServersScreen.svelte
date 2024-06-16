<script>
    import {invoke} from "@tauri-apps/api";
    import VirtualList from "../utils/VirtualList.svelte";
    import FeaturedServerItem from "./featured/FeaturedServerItem.svelte";
    import CustomServerItem from "./custom/CustomServerItem.svelte";
    import CustomServerDetails from "./custom/CustomServerDetails.svelte";
    import CreateCustomServerScreen from "./custom/CreateCustomServerScreen.svelte";
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher()

    export let currentBranch;
    export let options;
    export let featureWhitelist;
    export let forceServer;
    export let customServerLogs;
    export let customServerProgress;
    let featuredServers = [];
    let customServers = [];
    let customServerLimit = 0;
    let baseDomain;
    let currentTabIndex = 0;
    let createCustomServer = false;
    let customServerDetails = null;

    async function loadData() {
        featuredServers = null;
        customServers = null;
        const loginData = options.accounts.find(obj => obj.uuid === options.currentUuid);

        await invoke("get_featured_servers", { branch: currentBranch }).then((result) => {
            featuredServers = result;
        }).catch((e) => {
            featuredServers = [];
            console.error(e);
            alert("Failed to load featured servers:\n" + e);
        });

        if (featureWhitelist.includes("CUSTOM_SERVERS")) {
            await invoke("get_custom_servers", {
                token: options.experimentalMode ? loginData.experimentalToken : loginData.noriskToken,
                uuid: options.currentUuid
            }).then((result) => {
                console.log(`Loaded custom servers: `);
                console.log(result);
                customServers = result.servers;
                customServerLimit = result.limit;
                baseDomain = result.baseUrl;
                customServers.forEach(server => {
                    if (!customServerLogs[server._id]) {
                        customServerLogs[server._d] = [];
                    }
                });
            }).catch((e) => {
                customServers = [];
                console.error(e);
                alert("Failed to load custom servers:\n" + e);
            });
        }

    }

    loadData();
    console.log(featureWhitelist);
</script>

{#if createCustomServer}
    <CreateCustomServerScreen on:back={() => createCustomServer = false} on:backAndUpdate={() => { loadData(); createCustomServer = false; }} on:home={() => dispatch('home')} on:details={(details) => {customServerDetails = details.detail; customServerLogs[customServerDetails['_id']] = []; createCustomServer = false;}} bind:options={options} bind:customServerProgress={customServerProgress} baseDomain={baseDomain} />
{:else if customServerDetails != null}
    <CustomServerDetails on:back={() => customServerDetails = null} on:home={() => dispatch('home')} on:terminated={() => customServerLogs[customServerDetails._id] = []} bind:options={options} bind:customServer={customServerDetails} bind:logs={customServerLogs[customServerDetails._id]} />
{:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="home-button" on:click={() => dispatch("home")}>[HOME]</h1>
    <div class="servers-wrapper">
        {#if featureWhitelist.includes("CUSTOM_SERVERS")}
            <div class="navbar">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class:active-tab={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>Featured</h1>
                <h2>|</h2>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class:active-tab={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>Custom</h1>
            </div>
        {:else}
            <div class="navbar">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1>Featured Servers</h1>
            </div>
        {/if}
        {#if currentTabIndex === 0}
            {#if featuredServers !== null && featuredServers.length > 0 }
                <VirtualList height="30em" items={featuredServers} let:item>
                    <FeaturedServerItem
                        on:play={() => dispatch("play")}
                        bind:forceServer={forceServer}
                        server={item}/>
                </VirtualList>
            {:else}
                <h1 class="loading-indicator">{featuredServers != null ? 'No featured servers found.' : 'Loading...'}</h1>
            {/if}
        {:else if currentTabIndex === 1}
            <div class="customServerToolbar">
                <h4>Servers: {customServers?.length ?? 0} / {customServerLimit == -1 ? '∞' : customServerLimit ?? 0}</h4>
                {#if customServerLimit == -1 || customServers?.length < customServerLimit}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h4 class="create-server-button" on:click={() => createCustomServer = true}>Create</h4>
                {:else}
                    <h4 class="create-server-button-limit" title="You can only create a limited ammout of servers.">Limit reached</h4>
                {/if}
            </div>
            {#if customServers !== null && customServers.length > 0}
                <VirtualList height="30em" items={customServers} let:item>
                    <CustomServerItem
                        on:openDetails={() => customServerDetails = item}
                        options={options}
                        server={item}
                        bind:logs={customServerLogs[item._id]}/>
                </VirtualList>
            {:else}
                <h1 class="loading-indicator">{customServers != null ? 'You don\'t have any custom servers.' : 'Loading...'}</h1>
            {/if}
        {/if}
    </div>
{/if}

<style>
    .navbar {
        display: flex;
        gap: 1em;
        justify-content: center;
    }

    .navbar h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .navbar h1:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
        transform: scale(1.05);
    }

    .navbar h2 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0 2em 0.8em 2em;
        cursor: default;
    }

    .active-tab {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .loading-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-top: 200px;
    }

    .servers-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.7em;
    }

    .customServerToolbar {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding-left: 1em;
        padding-right: 1em;
        height: 40px;
    }

    .customServerToolbar h4 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
    }

    .create-server-button {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: #0bb00b;
        text-shadow: 2px 2px #086b08;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .create-server-button:hover {
        transform: scale(1.2);
    }

    .create-server-button-limit {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        color: red;
    }

    .home-button {
        position: absolute;
        bottom: 1em; /* Abstand vom oberen Rand anpassen */
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .home-button:hover {
        transform: scale(1.2);
    }
</style>