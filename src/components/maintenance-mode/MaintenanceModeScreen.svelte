<script>
    import MaintenanceModeTokenModal from "./MaintenanceModeTokenModal.svelte";
    import { appWindow } from "@tauri-apps/api/window";

    let maintenanceModeTokenPopup = false;
</script>

{#if maintenanceModeTokenPopup}
    <MaintenanceModeTokenModal bind:showModal={maintenanceModeTokenPopup}/>
{/if}
<div class="container">
    <div class="maintenance-mode">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="title text" on:click={() => maintenanceModeTokenPopup = true}>Maintenance Mode</h1>
        <p class="text">We are currently in maintenance mode.<br>Please try again later or check or Discord for more information.</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="discord" on:click={() => window.open("https://discord.norisk.gg", "_blanc")}>-&gt; Discord</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="quit-button" on:click={() => { appWindow.close(); }}>Exit</h1>
    </div>
</div>

<style>
    .text {
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        text-align: center;
    }

    .maintenance-mode {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
    }

    .maintenance-mode .title {
        margin-top: 50px;
        font-size: 30px;
        margin-bottom: 20px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .maintenance-mode p {
        font-size: 15px;
        text-shadow: none;
        padding: 0 35px;
    }

    .maintenance-mode .discord {
        cursor: pointer;
        color: #7289da;
        text-shadow: 2px 2px #4d5d97;
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-top: 20px;
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
</style>/