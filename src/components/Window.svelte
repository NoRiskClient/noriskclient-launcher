<script>
    import {invoke} from "@tauri-apps/api";
    import PokemonScreen from "./main/PokemonScreen.svelte";
    import StartUpScreen from "./updater/StartUpScreen.svelte";
    import UpdateManager from "./updater/UpdateManager.svelte";
    import MaintenanceModeTokenModal from "./maintenance-mode/MaintenanceModeTokenModal.svelte";
    import {checkUpdate} from "@tauri-apps/api/updater";
    import {onMount} from "svelte";
    import { appWindow } from "@tauri-apps/api/window";

    // Load options from file
    let options;
    let showUpdateScreen = null;
    let MAINTENANCE_MODE = false;
    let maintenanceModeTokenPopup = false;

    onMount(async () => {
        const reload = async (afterReload) => {
            await invoke("get_options").then(async (result) => {
                options = result;
                // Debug options - might be interesting to see what's in there
                console.debug("read options", options);

                // Easy way to store options
                options.store = async () => {
                    console.debug("storing options", options);
                    await invoke("store_options", {
                        options,
                    }).catch((e) => console.error(e));
                };

                options.reload = reload;

                options.toggleTheme = () => {
                    if (options.theme === "LIGHT") {
                        options.theme = "DARK";
                        window.document.body.classList.add(
                            "dark-mode",
                        );
                    } else {
                        options.theme = "LIGHT";
                        window.document.body.classList.remove(
                            "dark-mode",
                        );
                    }
                    invoke("store_options", { options }).catch(
                        (e) => console.error(e),
                    );
                };

                if (options.theme === "DARK") {
                    window.document.body.classList.add(
                        "dark-mode",
                    );
                } else {
                    window.document.body.classList.remove(
                        "dark-mode",
                    );
                }

                try {
                    const { shouldUpdate } = await checkUpdate();
                    showUpdateScreen = shouldUpdate;
                    invoke("console_log_info", {
                        message: `Checking for Updates... ${shouldUpdate}`,
                    }).catch((e) => console.error(e));
                } catch (error) {
                    showUpdateScreen = false;
                    invoke("console_log_error", {
                        message: "error",
                    }).catch((e) => console.error(e));
                }
            });
        }
        reload()
    });

    invoke("check_maintenance_mode").then((isInMaintenance) => {
        if (isInMaintenance) {
            MAINTENANCE_MODE = true;
        }
    }).catch(e => {
        console.error(e);
    });


    invoke("check_online_status").then((result) => {
        console.debug("online status", result);
    }).catch(e => {
        alert("You are offline! Please connect to the internet and restart the app.\n If this problem persists, please contact the developer.\n\n (Error: " + e + ")");
        console.error(e);
    });
</script>

<div class="window">
    {#if showUpdateScreen !== null && options !== null}
        {#if showUpdateScreen}
            <UpdateManager/>
        {:else}
            {#if MAINTENANCE_MODE}
                {#if maintenanceModeTokenPopup}
                    <MaintenanceModeTokenModal bind:showModal={maintenanceModeTokenPopup} bind:maintenanceMode={MAINTENANCE_MODE}/>
                {/if}
                <div class="black-bar" data-tauri-drag-region></div>
                <div class="maintenance-mode">
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="title text" on:click={() => maintenanceModeTokenPopup = true}>Maintenance Mode</h1>
                    <p class="text">The server is currently in maintenance mode. Please try again later.</p>
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <h1 class="quit-button" on:click={() => { appWindow.close(); }}>Exit</h1>
                </div>
                <div class="black-bar" data-tauri-drag-region></div>
            {:else}
                <PokemonScreen bind:options={options}></PokemonScreen>
            {/if}
        {/if}
    {:else}
        <StartUpScreen/>
    {/if}
</div>

<style>
    .black-bar {
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }
    
    .text {
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
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

    .quit-button {
        cursor: pointer;
        margin-top: 100px;
        color: red;
        text-shadow: 2px 2px #460000;
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
