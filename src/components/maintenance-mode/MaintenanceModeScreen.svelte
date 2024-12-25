<script>
    import { open } from '@tauri-apps/api/shell';
    import { appWindow } from "@tauri-apps/api/window";
    import { openInputPopup } from "../../utils/popupUtils.js";
    import { setMaintenanceMode } from "../../utils/noriskUtils.js";
    import { translations } from './../../utils/translationUtils.js';

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    function openMaintenanceModeTokenPopup() {
        openInputPopup({
            title: lang.maintenanceMode.popup.title,
            content: lang.maintenanceMode.popup.content,
            inputPlaceholder: lang.maintenanceMode.popup.inputPlaceholder,
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
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <h1 class="title text primary-text" on:click={openMaintenanceModeTokenPopup}>{lang.maintenanceMode.title}</h1>
        <p class="text">{@html lang.maintenanceMode.text}</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <p class="discord" on:click={() => open("https://discord.norisk.gg")}>-&gt; Discord</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <h1 class="quit-button red-text" on:click={() => { appWindow.close(); }}>{lang.maintenanceMode.button.exit}</h1>
    </div>
</div>

<style>
    .text {
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
            text-align: center;
        font-size: 40px;
        cursor: pointer;
        transition-duration: 300ms;
    }

    .quit-button:hover {
        transform: scale(1.3);
    }
</style>