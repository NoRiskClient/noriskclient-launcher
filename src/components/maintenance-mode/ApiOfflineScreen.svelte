<script>
    import MaintenanceModeTokenModal from "./MaintenanceModeTokenModal.svelte";
    import { appWindow } from "@tauri-apps/api/window";

    let maintenanceModeTokenPopup = false;
</script>

{#if maintenanceModeTokenPopup}
    <MaintenanceModeTokenModal bind:showModal={maintenanceModeTokenPopup}/>
{/if}
<div class="container">
    <div class="api-offline">
        <h1 class="title text">API Offline!</h1>
        <p class="text">Our API is currently offline.<br>Please try again later or check or Discord for more information.</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="discord" on:click={() => window.open("https://discord.norisk.gg", "_blanc")}>-&gt; Discord</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="quit-button" on:click={() => { appWindow.close(); }}>Exit</h1>
    </div>
</div>

<style>
    .text {
        font-family: 'Press Start 2P', serif;
        color: var(--font-color);
        text-shadow: 1.25px 1.25px var(--font-color-text-shadow);
        text-align: center;
        line-height: 17.5px;
        width: 95%;
    }

    .api-offline {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
    }

    .api-offline .title {
        margin-top: 50px;
        font-size: 30px;
        margin-bottom: 1em;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .api-offline p {
        font-size: 15px;
        padding: 0px 35px;
    }

    .api-offline .discord {
        cursor: pointer;
        color: #7289da;
        text-shadow: 2px 2px #4d5d97;
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-top: 20px;
        transition-duration: 200ms;
    }

    .api-offline .discord:hover {
        transform: scale(1.2);
    }

    .quit-button {
        cursor: pointer;
        margin-top: 100px;
        color: red;
        text-shadow: 4px 4px #460000;
        font-family: 'Press Start 2P', serif;
        text-align: center;
        font-size: 40px;
        cursor: pointer;
        transition-duration: 300ms;
    }

    .quit-button:hover {
        transform: scale(1.3);
    }
</style>