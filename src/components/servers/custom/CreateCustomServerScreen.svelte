<script>
    import { invoke } from "@tauri-apps/api";
    import { pop } from "svelte-spa-router";
    import NameIconSubdomainTab from "./create/NameIconSubdomainTab.svelte";
    import VersionTab from "./create/VersionTab.svelte";
    import LoaderVersionTab from "./create/LoaderVersionTab.svelte";
    import TypeTab from "./create/TypeTab.svelte";
    import EulaTab from "./create/EulaTab.svelte";
    import VanillaIcon from "../../../images/custom-servers/vanilla.png";
    import ForgeDarkIcon from "../../../images/custom-servers/forge_dark.png";
    import ForgeWhiteIcon from "../../../images/custom-servers/forge_white.png";
    import NeoForgeIcon from "../../../images/custom-servers/neo_forge.png";
    import FabricIcon from "../../../images/custom-servers/fabric.png";
    import QuiltIcon from "../../../images/custom-servers/quilt.png";
    import PaperIcon from "../../../images/custom-servers/paper.png";
    import FoliaIcon from "../../../images/custom-servers/folia.png";
    import PurpurIcon from "../../../images/custom-servers/purpur.png";
    import BukkitIcon from "../../../images/custom-servers/bukkit.png";
    import SpigotIcon from "../../../images/custom-servers/spigot.png";
    import { createEventDispatcher } from "svelte";
    import { launcherOptions } from "../../../stores/optionsStore.js";
    import { defaultUser } from "../../../stores/credentialsStore.js";
    import { customServerBaseDomain } from "../../../stores/customServerStore.js";
    import { customServerProgress, setCustomServerProgress, noriskLog } from "../../../utils/noriskUtils.js";
    import { addCustomServer, setActiveCustomServerId } from "../../../stores/customServerStore.js";
    import { addNotification } from "../../../stores/notificationStore.js";
    import { translations } from '../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    let createdServer;

    /**
     * Flow: Server Name & Icon & Subdomain -> Server Type -> Mc Version -> ggf Loader Version -> Info -> [Details]
     */
    let currentTab = "NAME_ICON_SUBDOMAIN";
    let name = "";
    let subdomain = "";
    let icon = null;
    let type = "";
    let mcVersion = "";
    let majorVersion = "";
    let loaderVersion = null;
    let eula = false;

    let availableTypes = {
        "VANILLA": {
            "name": "Vanilla",
            "type": "VANILLA",
            "iconUrl": VanillaIcon,
            "downloadHash": "",
            "requiresLoader": false,
            "versions": []
        },
        "FABRIC": {
            "name": "Fabric",
            "type": "FABRIC",
            "iconUrl": FabricIcon,
            "requiresLoader": true,
            "versions": [],
            "loaderVersions": []
        },
        "QUILT": {
            "name": "Quilt",
            "type": "QUILT",
            "iconUrl": QuiltIcon,
            "requiresLoader": true,
            "versions": [],
            "loaderVersions": []
        },
        "FORGE": {
            "name": "Forge",
            "type": "FORGE",
            "iconUrl": $launcherOptions.theme == "DARK" ? ForgeWhiteIcon : ForgeDarkIcon,
            "requiresLoader": true,
            "versions": [],
            "loaderVersions": []
        },
        "NEO_FORGE": {
            "name": "Neo Forge",
            "type": "NEO_FORGE",
            "iconUrl": NeoForgeIcon,
            "requiresLoader": true,
            "versions": [],
            "loaderVersions": []
        },
        "PAPER": {
            "name": "Paper",
            "type": "PAPER",
            "iconUrl": PaperIcon,
            "requiresLoader": false,
            "versions": []
        },
        "FOLIA": {
            "name": "Folia",
            "type": "FOLIA",
            "iconUrl": FoliaIcon,
            "requiresLoader": false,
            "versions": []
        },
        "PURPUR": {
            "name": "Purpur",
            "type": "PURPUR",
            "iconUrl": PurpurIcon,
            "requiresLoader": false,
            "versions": []
        },
        "SPIGOT": {
            "name": "Spigot",
            "type": "SPIGOT",
            "iconUrl": SpigotIcon,
            "requiresLoader": false,
            "versions": []
        },
        "BUKKIT": {
            "name": "Bukkit",
            "type": "BUKKIT",
            "iconUrl": BukkitIcon,
            "requiresLoader": false,
            "versions": []
        }
    };

    async function createServer() {
        const server = {
            name: name,
            subdomain: subdomain.toLowerCase(),
            icon: icon,
            type: type,
            mcVersion: mcVersion,
            loaderVersion: loaderVersion,
            eula: eula
        };
        await invoke("create_custom_server", {
            name: server.name,
            mcVersion: server.mcVersion,
            loaderVersion: server.loaderVersion,
            type: server.type,
            subdomain: server.subdomain,
            token: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
            uuid: $defaultUser.id,
        }).then(async (newServer) => {
            noriskLog("Created Server: " + JSON.stringify(newServer));
            createdServer = newServer;
            addCustomServer(newServer);
            setCustomServerProgress(newServer._id, { label: lang.servers.custom.create.initializing, progress: 0, max: 0 });
            
            let additionalData = null;
            if (newServer.type == "VANILLA") {
                additionalData = availableTypes[type].downloadHash;
            }
            
            currentTab = "INITIALIZING";

            await invoke("initialize_custom_server", {
                customServer: newServer,
                additionalData: additionalData,
                token: $launcherOptions.experimentalMode ? $defaultUser.norisk_credentials.experimental.value : $defaultUser.norisk_credentials.production.value,
            }).then(() => {
                noriskLog("Initialized Server: " + JSON.stringify(newServer));
                setActiveCustomServerId(newServer._id, true);
            }).catch((error) => {
                dispatch("back");
                addNotification(lang.servers.custom.create.notification.failedToInitialize.replace("{error}", error));
            });
        }).catch((error) => {
            dispatch("back");
            addNotification(lang.servers.custom.create.notification.failedToCreate.replace("{error}", error));
        });
    }
</script>

<div class="create-server-wrapper">
    {#if currentTab === "NAME_ICON_SUBDOMAIN"}
        <NameIconSubdomainTab bind:name={name} bind:icon={icon} bind:subdomain={subdomain} baseDomain={$customServerBaseDomain} on:next={() => currentTab = "TYPE"}/>
    {:else if currentTab === "TYPE"}
        <TypeTab bind:type={type} bind:version={mcVersion} bind:majorVersion={majorVersion} bind:loaderVersion={loaderVersion} bind:availableTypes={availableTypes} on:back={() => currentTab = "NAME_ICON_SUBDOMAIN"} on:next={() => currentTab = "VERSIONS"}/>
    {:else if currentTab === "VERSIONS"}
        <VersionTab bind:type={type} bind:availableTypes={availableTypes} bind:version={mcVersion} bind:majorVersion={majorVersion} on:back={() => currentTab = "TYPE"} on:next={() => currentTab = availableTypes[type].requiresLoader ? "LOADER_VERSIONS" : "INFO"}/>
    {:else if currentTab === "LOADER_VERSIONS"}
        <LoaderVersionTab bind:type={type} bind:availableTypes={availableTypes} bind:version={mcVersion} bind:loaderVersion={loaderVersion} on:back={() => currentTab = "VERSIONS"} on:next={() => currentTab = "INFO"}/>
    {:else if currentTab === "INFO"}
        <EulaTab bind:eula={eula} on:back={() => currentTab = availableTypes[type].requiresLoader ? "LOADER_VERSIONS" : "VERSIONS"} on:next={createServer} />
    {:else if currentTab === "INITIALIZING"}
        <div class="center">
            <h1>{$customServerProgress[createdServer._id] ? $customServerProgress[createdServer._id].label : lang.servers.custom.create.initializing}</h1>
        </div>
    {/if}
</div>

<style>
    .create-server-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 1.5em;
        gap: 0.7em;
    }

    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
    }

    .center {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        width: 100%;
    }
</style>
