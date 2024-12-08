<script>
    import {createEventDispatcher} from "svelte";
    import NRCLogo from "../../../images/norisk_logo.png";
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
    import { customServerLogs } from "../../../stores/customServerLogsStore.js";
    import { launcherOptions } from "../../../stores/optionsStore.js";
    import { translations } from '../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let server;

    let loaderIcon;
    switch (server.type.toUpperCase()) {
        case "VANILLA":
            loaderIcon = VanillaIcon
            break;
        case "FORGE":
            loaderIcon = $launcherOptions.theme == "DARK" ? ForgeWhiteIcon : ForgeDarkIcon
            break;
        case "NEO_FORGE":
            loaderIcon = NeoForgeIcon
            break;
        case "FABRIC":
            loaderIcon = FabricIcon
            break;
        case "QUILT":
            loaderIcon = QuiltIcon
            break;
        case "PAPER":
            loaderIcon = PaperIcon
            break;
        case "FOLIA":
            loaderIcon = FoliaIcon
            break;
        case "PURPUR":
            loaderIcon = PurpurIcon
            break;
        case "BUKKIT":
            loaderIcon = BukkitIcon
            break;
        case "SPIGOT":
            loaderIcon = SpigotIcon
            break;
        default:
            loaderIcon = VanillaIcon
            break;
    }
</script>

<div class="server-item-wrapper">
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        <img class="icon" src={NRCLogo} alt="Server Icon">
        <div class="text-item-wrapper">
            <div class="name-wrapper">
                <img src={loaderIcon} alt="server-loader-icon">
                <h4 class="server-name">{server.name}</h4>
            </div>
            <div class="infoBar">
                <div
                    class="statusBlob"
                    class:stopped={($customServerLogs[server._id] ?? []).length < 1}
                    class:starting={($customServerLogs[server._id] ?? []).length > 0 && !($customServerLogs[server._id] ?? []).join(' ').includes('Done')}
                    class:running={($customServerLogs[server._id] ?? []).length > 0 && ($customServerLogs[server._id] ?? []).join(' ').includes('Done')}
                    class:stopping={($customServerLogs[server._id] ?? []).length > 0 && ($customServerLogs[server._id] ?? []).join(' ').includes('Stopping server')}
                />
                <p> | {server.subdomain}.{server.domain} | {server.mcVersion}</p>
            </div>
        </div>
    </div>
    <div class="buttons">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="details-button primary-text" on:click={() => dispatch("openDetails")}>
            {lang.servers.custom.button.details}
        </h1>
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
        cursor: default;
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
        width: 30px;
        height: 30px;
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
    }

    .server-name {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
            line-break: anywhere;
        font-size: 18px;
    }

    .server-item-wrapper p {
        width: 350px;
        font-size: 10px;
        line-height: 1.2em;
        padding-top: 2em;
    }

    .details-button {
        font-size: 17px;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .details-button:hover {
        transform: scale(1.2);
    }

    .infoBar {
        display: flex;
        flex-direction: row;
        gap: 7.5px;
        align-items: center;
        justify-content: center;
    }

    .statusBlob {
        width: 15px;
        height: 15px;
        border-radius: 50%;
        border: none;
        margin-top: 16px;
    }
    
    .statusBlob.stopped {
        background-color: #ff0000;
        -webkit-box-shadow:0px 0px 5px 2px #a80000;
        -moz-box-shadow: 0px 0px 5px 2px #a80000;
        box-shadow: 0px 0px 5px 2px #a80000;
    }
    
    .statusBlob.starting {
        background-color: #ff9100;
        -webkit-box-shadow:0px 0px 5px 2px #d67900;
        -moz-box-shadow: 0px 0px 5px 2px #d67900;
        box-shadow: 0px 0px 5px 2px #d67900;
        animation: statusBlob 1.5s infinite;
    }
    
    .statusBlob.running {
        background-color: var(--green-text);
        -webkit-box-shadow:0px 0px 5px 2px var(--green-text-shadow);
        -moz-box-shadow: 0px 0px 5px 2px var(--green-text-shadow);
        box-shadow: 0px 0px 5px 2px var(--green-text-shadow);
        animation: statusBlob 1.5s infinite;
    }

    .statusBlob.stopping {
        background-color: #ff7300;
        -webkit-box-shadow:0px 0px 5px 2px #d66000;
        -moz-box-shadow: 0px 0px 5px 2px #d66000;
        box-shadow: 0px 0px 5px 2px #d66000;
        animation: statusBlob 1.5s infinite;
    }

    @keyframes statusBlob {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.2);
        }
        100% {
            transform: scale(1);
        }
    }
</style>
