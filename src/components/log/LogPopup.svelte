<script>
    import { fly } from "svelte/transition";
    import {createEventDispatcher} from "svelte";
    import VirtualList from "../utils/VirtualList.svelte";
    import LogMessage from "./LogMessage.svelte";
    import ConfigRadioButton from "../config/inputs/ConfigRadioButton.svelte";
    import { invoke } from "@tauri-apps/api";
    import { addNotification } from "../../stores/notificationStore.js";

    export let messages;

    let autoScroll = true;

    const dispatch = createEventDispatcher();

    async function uploadLogs() {
        await invoke("upload_logs", {
            log: messages.join("")
        }).then((result) => {
            addNotification("Logs uploaded successfully. URL copied to clipboard.", "INFO");
            navigator.clipboard.writeText(result.url)
        }).catch((error) => {
            addNotification("Failed to upload logs: " + error);
        })
    }

    // Only split when necessary - fixes no-newline-messages resulting in "undefined"
    function formatLogMessage(message) {
        let messageSplit = message.split("]: ", 2)
        return messageSplit[messageSplit.length - 1]
    }
</script>

<div class="log" transition:fly={{ y: -10, duration: 200 }}>
    <div class="header">
        <div class="title nes-font">CLIENT LOG</div>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="title nes-font red-text-clickable" on:click={() => dispatch("hideClientLog")}>X</div>
    </div>

    <div class="output">
        <VirtualList items={messages} let:item {autoScroll}>
            <LogMessage text={formatLogMessage(item)}/>
        </VirtualList>
    </div>

    <div class="bottom">
        <ConfigRadioButton bind:value={autoScroll} text="Auto Scroll"/>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="primary-text" on:click={uploadLogs}>COPY</p>
    </div>
</div>

<style>
    .log {
        width: calc(100% - 150px);
        height: calc(100% - 150px);
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: var(--background-contrast-color);
        backdrop-filter: blur(10px);
        padding: 25px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        border: 5px solid black;
    }

    .bottom {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .bottom p {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        user-select: none;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .bottom p:hover {
        transform: scale(1.2);
    }

    .output {
        flex: 1;
        overflow: hidden;
        margin-bottom: 10px;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        user-select: none;
    }

    .title {
        font-size: 30px;
    }
</style>

