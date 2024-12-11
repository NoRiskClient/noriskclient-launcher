<script>
    import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
    import { addNotification } from "../../stores/notificationStore.js";
    import { onMount } from "svelte";
    import { pop, replace } from "svelte-spa-router";
    import { invoke } from "@tauri-apps/api/tauri";
    import { runClient, noriskLog } from "../../utils/noriskUtils.js";
    import ConfigFolderInput from "../config/inputs/ConfigFolderInput.svelte";
    import { translations } from '../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    $: path = '';

    onMount(async () => {
        invoke("get_default_mc_folder").then(res => {
            path = res;
        }).catch(err => {
            path = null;
            addNotification("An error occurred while getting the default minecraft folder: " + err);
        });
    });

    async function cloneMinecraftData(dontClone = false) {
        if (dontClone) {
            pop();
            runClient($branches[$currentBranchIndex], true);
            return;
        }

        noriskLog("Copying data from minecraft: " + path);
        replace("/copy-mc-data-progress");
        invoke("copy_mc_data", { path: path, branch: $branches[$currentBranchIndex] }).then(() => {
            noriskLog("Data copied successfully!");
            pop();
            runClient($branches[$currentBranchIndex], true);
        }).catch(error => {
            pop();
            addNotification(lang.copyMcData.notification.errorWhileCopyingData.replace("{error}", error));
        });
    }
</script>

<div class="container">
    <div class="header">
        <h1>{lang.copyMcData.firstInstall.title}</h1>
        <p>{@html lang.copyMcData.firstInstall.infoText}</p>
    </div>
    <div class="mcFolder">
        <ConfigFolderInput title={lang.copyMcData.selectDataFolder.tooltip} bind:value={path} />
    </div>
    <div class="branches">
        <div class="branch">
            <p class="branchName green-text">{lang.copyMcData.button.cloneMinecraftData}</p>
            <div class="buttons">
                <p class="arrow">&gt;</p>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <p class="cloneButton primary-text" on:click={() => cloneMinecraftData()}>{lang.copyMcData.button.clone}</p>
            </div>
        </div>
        <div class="branch">
            <p class="branchName red-text">{lang.copyMcData.button.dontClone}</p>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <p class="staticArrow" on:click={() => cloneMinecraftData(true)}>-&gt;</p>
        </div>
    </div>
</div>
    
<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 80vh;
        width: 100vw;
            color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }
    
    .header {
        display: flex;
        flex-direction: column;
        text-align: center;
        gap: 3em;
        height: 15em;
        padding-top: 2em;
    }

    .header h1 {
        font-size: 25px;
    }

    .header p {
        font-size: 12.5px;
        line-height: 17.5px;
        padding: 20px;
    }

    .mcFolder {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 80%;
        margin-bottom: 4em;
    }

    .branches {
        display: flex;
        flex-direction: column;
        width: 100vw;
        justify-content: center;
        align-items: center;
        height: max-content;
    }

    .branch {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px;
        background-color: var(--background-contrast-color);
        border-radius: 5px;
        margin-bottom: 1em;
        overflow-x: hidden;
        width: 80vw;
    }

    .branchName {
        font-size: 15px;
    }

    .branch:hover > * > .arrow {
        transform: translateX(60px);
        opacity: 0%;
    }

    .branch:hover > * > .cloneButton {
        transform: translateX(0px);
        opacity: 100%;
    }
    
    .arrow {
        position: absolute;
        font-size: 25px;
        padding-left: 40px;
        transform: translateX(20px);
        transition-duration: 200ms;
    }

    .cloneButton {
        font-size: 15px;
        padding: 5px;
        border-radius: 7.5px;
        cursor: pointer;
        transform: translateX(100px);
        transition-duration: 200ms;
    }

    .buttons:hover > .cloneButton {
        transform: scale(1.175);
    }

    .staticArrow {
        font-size: 25px;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .staticArrow:hover {
        transform: scale(1.175);
        color: red;
        text-shadow: 2px 2px #460000;
    }
</style>