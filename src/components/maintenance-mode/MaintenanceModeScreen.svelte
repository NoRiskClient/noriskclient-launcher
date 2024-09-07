<script>
    import { appWindow } from "@tauri-apps/api/window";
    import { openInputPopup } from "../../utils/popupUtils.js";
    import { setMaintenanceMode } from "../../utils/noriskUtils.js";

    function openMaintenanceModeTokenPopup() {
        openInputPopup({
            title: "Maintenance Mode",
            content: "Please enter the maintenance mode token.",
            inputPlaceholder: "Your Token...",
            validateInput: (input) => input == "bro_wieso_suchst_du_dannach_?_warte_halt_noch_bissl",
            liveValidation: false,
            onConfirm: () => setMaintenanceMode(false),
            titleFontSize: "20px",
        });
    }
</script>

<div class="container">
    <div class="maintenance-mode">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="title text primary-text" on:click={openMaintenanceModeTokenPopup}>Maintenance Mode</h1>
        <p class="text">We are currently in maintenance mode.<br>Please try again later or check or Discord for more information.</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="discord" on:click={() => window.open("https://discord.norisk.gg", "_blanc")}>-&gt; Discord</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="quit-button red-text" on:click={() => { appWindow.close(); }}>Exit</h1>
    </div>
</div>

<style>
    .text {
        font-family: 'Press Start 2P', serif;
        text-align: center;
        width: 95%;
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
        margin-bottom: 1em;
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
        transition-duration: 200ms;
    }

    .maintenance-mode .discord:hover {
        transform: scale(1.2);
    }

    .quit-button {
        cursor: pointer;
        margin-top: 100px;
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