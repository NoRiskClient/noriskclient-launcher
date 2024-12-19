<script>
	import { relaunch } from '@tauri-apps/api/process';
    import Router from "./Router.svelte";
    import {onMount} from "svelte";
    import {defaultUser, fetchDefaultUserOrError} from "./stores/credentialsStore.js";
    import {fetchOptions} from "./stores/optionsStore.js";
    import {fetchBranches} from "./stores/branchesStore.js";
    import {fetchProfiles} from "./stores/profilesStore.js";
    import {startMicrosoftAuth} from "./utils/microsoftUtils.js";
    import {listen} from "@tauri-apps/api/event";
    import {push} from "svelte-spa-router";
    import {
        isApiOnline,
        checkApiStatus,
        getClientInstances,
        getMaintenanceMode,
        getNoRiskUser,
        getVersion,
        noriskError,
        noriskLog
    } from "./utils/noriskUtils.js";
    import {launcherOptions} from "./stores/optionsStore.js";
    import {profiles} from "./stores/profilesStore.js";
    import {getAnnouncements, getChangeLogs, getLastViewedPopups} from "./utils/popupUtils.js";
    import {appWindow} from "@tauri-apps/api/window";
    import {invoke} from "@tauri-apps/api";
    import {addNotification} from "./stores/notificationStore.js";
    import {language, setLanguage, translations} from "./utils/translationUtils.js";

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    onMount(async () => {
        setTimeout(async () => {
            await appWindow.show();
        }, 300);
        await getVersion();
        await fetchOptions();
        await checkApiStatus();
        setLanguage($language);

        await fetchDefaultUserOrError(false);
        const isTokenValid = await getNoRiskUser();
        if ($isApiOnline) {
            if (isTokenValid) {
                await fetchBranches();
                await fetchProfiles();
                await getMaintenanceMode();
                await getChangeLogs();
                await getAnnouncements();
                await getLastViewedPopups();
            } else {
                await startMicrosoftAuth();
            }
        }

        const isOnlineInterval = setInterval(async () => {
            await checkApiStatus();
        }, 30 * 1000) //des bedarfs anpassen? -> Tim: 30 sek is fair oder? :)

        const clientInstancesInterval = setInterval(async () => {
            //Hoffe das passt lol
            await getClientInstances();
        }, 2500);

        let unlisten = await listen("client-exited", () => {
            getClientInstances();
            push("/");
        });

        const minecraftCrashUnlisten = await listen("minecraft-crash", async (event) => {
            const crashReportPath = event.payload; // Extract the path from the event's payload
            noriskError("Crash Report Path: " + crashReportPath);
            await invoke("open_minecraft_crash_window", {crashReportPath: crashReportPath})
                .catch(reason => {
                    addNotification(reason);
                    noriskError(reason);
                });
        });

        const userUnlisten = defaultUser.subscribe(async value => {
            noriskLog("Default User Was Updated.");
            await fetchBranches();
            await fetchProfiles();
            const isTokenValid = await getNoRiskUser();
            if (!isTokenValid) {
                await getMaintenanceMode();
                await getChangeLogs();
                await getAnnouncements();
                await getLastViewedPopups();
            }
        });

        return () => {
            unlisten();
            minecraftCrashUnlisten();
            userUnlisten();
            clearInterval(clientInstancesInterval);
            clearInterval(isOnlineInterval);
        };
    });

    let isFixing = false;
    async function fixAndRestart() {
        if (isFixing) return;
        isFixing = true;
        await invoke("clear_cache").then(() => {
            noriskLog("Launcher fixed successfully. -> Restarting...");
            relaunch();
        }).catch(reason => {
            addNotification(reason);
            noriskError(reason);
        });
    }
</script>

<main>
    <!-- Ensure translations are loaded before showing UI -->
    {#if lang?.dummy}
        <Router/>
    {/if}

    {#if !($launcherOptions || $profiles || $defaultUser)}
        <!-- Hier extra keine translations, falls das language loaden iwie auch bruch ist. -->
        <div class="fix-blackscreen" data-tauri-drag-region>
            <p class="info">Something went wrong setting up your launcher! :/</p>
            {#if isFixing}
                <p class="info">Fixing...<br>The launcher will automatically restart soon!</p>
            {:else}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="button red-text" on:click={fixAndRestart}>Fix & Restart</h1>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 class="button exit-button red-text" on:click={appWindow.close}>Exit</h1>
            {/if}
        </div>
    {/if}
</main>

<style>
    .fix-blackscreen {
        position: absolute;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100vh;
        width: 100vw;
        opacity: 0;
        animation: fadeIn 1s forwards;
        z-index: 1;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .fix-blackscreen .info {
        font-size: 0.85em;
        margin-bottom: 3em;
    }

    .fix-blackscreen .button {
        cursor: pointer;
        transition-duration: 300ms;
    }

    .fix-blackscreen .button:hover {
        transform: scale(1.1);
    }

    .exit-button {
        margin-top: 3em;
    }
</style>
