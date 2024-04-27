<script>
    import {checkUpdate, installUpdate, onUpdaterEvent} from "@tauri-apps/api/updater";
    import {relaunch} from "@tauri-apps/api/process";
    import {onMount} from "svelte";
    import { invoke } from "@tauri-apps/api";

    invoke("console_log_info", { message: "Starting Update Checker.." }).catch(e => console.error(e));
    let dots = "";
    let isFinished = false

    onMount(async () => {

        const unlisten = await onUpdaterEvent(({error, status}) => {
            // This will log all updater events, including status updates and errors.
            invoke("console_log_info", { message: `Updater event: ${error} ${status}` }).catch(e => console.error(e));
        });

        let interval;

        try {
            const {shouldUpdate, manifest} = await checkUpdate();

            if (shouldUpdate) {
                interval = animateLoadingText();
                invoke("console_log_info", { message: `Installing update: ${manifest?.version} ${manifest?.body}` }).catch(e => console.error(e));

                // Install the update. This will also restart the app on Windows!
                await installUpdate();
                invoke("console_log_info", { message: `Update was installed` }).catch(e => console.error(e));

                isFinished = true;

                invoke("console_log_info", { message: `Trying to relaunch` }).catch(e => console.error(e));
                await relaunch();
            }
        } catch (error) {
            invoke("console_log_error", { message: `${error}` }).catch(e => console.error(e));
            console.error(error);
        }

        return () => {
            clearInterval(interval);
            unlisten();
        };
    });

    function animateLoadingText() {
        return setInterval(function () {
            dots += " .";
            if (dots.length > 6) {
                dots = "";
            }
        }, 500);
    }

    function restart() {
        relaunch()
    }
</script>

<div class="black-bar" data-tauri-drag-region=""></div>
<div class="content">
    {#if isFinished}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 on:click={restart}>Press Start</h1>
    {:else}
        <h1>Updating Launcher {dots}</h1>
    {/if}
</div>
<div class="black-bar" data-tauri-drag-region=""></div>

<style>
    .black-bar {
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }

    .content {
        background-color: var(--background-color);
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
        gap: 20px;
        padding: 20px; /* Innenabstand für den Schlagschatten */
    }

    .content h1:hover {
        color: var(--hover-color);
        text-shadow: 1px 1px var(--hover-color-text-shadow);
        transform: scale(1.2);
    }

    .content h1 {
        font-size: 20px;
        font-family: 'Press Start 2P', serif;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
        transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
    }
</style>
