<script>
    import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import { pop, replace } from "svelte-spa-router";
    import VirtualList from "../utils/VirtualList.svelte";
    import { invoke } from "@tauri-apps/api/tauri";
    import { onMount } from "svelte";
    import { runClient, noriskLog } from "../../utils/noriskUtils.js";
    import { addNotification } from "../../stores/notificationStore.js";
    import { openInputPopup } from "../../utils/popupUtils.js";

    const dontCloneDataText = "Don't clone any data";
    const cloneMinecraftDataText = "Clone Minecraft Data";

    let availableBranches = [];
    let path = '';

    onMount(() => {
        invoke("get_branches_from_folder").then(branches_from_folder => {
            availableBranches = branches_from_folder.filter(b => b != $branches[$currentBranchIndex]).map(b => b == ($launcherOptions.experimentalMode ? $launcherOptions.latestDevBranch : $launcherOptions.latestBranch) ? `${b} (last played)` : b)
            availableBranches.push(cloneMinecraftDataText);
            availableBranches.push(dontCloneDataText);
        }).catch(error => {
            addNotification("An error occurred while getting the branches: " + error);
        });
    });

    async function cloneBranchData(branch) {
        if (branch == null) {
            pop();
            runClient($branches[$currentBranchIndex], true);
            return;
        }

        noriskLog("Copying data from branch " + branch);
        replace("/copy-mc-data-progress");
        invoke("copy_branch_data", { oldBranch: branch, newBranch: $branches[$currentBranchIndex] }).then(() => {
            noriskLog("Data copied successfully!");
            pop();
            runClient($branches[$currentBranchIndex], true);
        }).catch(err => {
            addNotification("An error occurred while copying the data: " + err);
        });
    }

    async function openCloneMinecraftDataPopup() {
        invoke("get_default_mc_folder").then(res => {
            path = res;
            openInputPopup({
                title: "Select Minecraft Path",
                content: "Please select the minecraft data path you want to clone the data from.\nThe default value is your normal \".minecraft\" folder.",
                inputType: "FOLDER",
                inputName: "",
                inputValue: path,
                confirmButton: "Clone",
                titleFontSize: "15px",
                width: 35,
                height: 25,
                validateInput: (path) => path != '',
                onConfirm: (path) => cloneMinecraftData(path)
            })
        }).catch(err => {
            path = null;
            addNotification("An error occurred while getting the default minecraft folder: " + err);
        });
    }

    async function cloneMinecraftData(path) {
        noriskLog("Copying minecraft data from path: " + path);
        replace("/copy-mc-data-progress");
        invoke("copy_mc_data", { path: path, branch: $branches[$currentBranchIndex] }).then(() => {
            noriskLog("Minecraft data copied successfully!");
            pop();
            runClient($branches[$currentBranchIndex], true);
        }).catch(err => {
            addNotification("An error occurred while copying the minecraft data: " + err);
        });
    }
</script>

<div class="container">
    <div class="header">
        <h1>New Branch Detected</h1>
        <p>You have just started "{$branches[$currentBranchIndex]}" for the first time.<br>To make the transition cleaner and faster you can copy your settings and servers from other branches below.</p>
    </div>
    <div class="branches">
        <VirtualList height="20em" items={availableBranches} let:item>
            <div class="branch">
                <p class="branchName" class:red-text={item == dontCloneDataText} class:green-text={item == cloneMinecraftDataText}>{item}</p>
                {#if item == cloneMinecraftDataText}
                    <div class="buttons">
                        <p class="arrow cloneMinecraft">&gt;</p>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <p class="cloneButton cloneMinecraft primary-text" on:click={openCloneMinecraftDataPopup}>Select Path</p>
                    </div>
                {:else if item == dontCloneDataText}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <p class="staticArrow" on:click={() => cloneBranchData(null)}>-&gt;</p>
                {:else}
                    <div class="buttons">
                        <p class="arrow">&gt;</p>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <p class="cloneButton primary-text" on:click={() => cloneBranchData(item.replace(' (last played)', ''))}>Clone</p>
                    </div>
                {/if}
            </div>
        </VirtualList>
    </div>
</div>
    
<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 80vh;
        font-family: 'Press Start 2P', serif;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }
    
    .header {
        display: flex;
        flex-direction: column;
        text-align: center;
        gap: 3em;
        height: 17.5em;
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
        width: 80vw;
    }

    .branchName {
        font-size: 15px;
    }

    .branch:hover > * > .arrow {
        transform: translateX(60px);
    }
    
    .branch:hover > * > .arrow.cloneMinecraft {
        transform: translateX(200px);
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

    .arrow.cloneMinecraft {
        transform: translateX(110px);
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

    .cloneButton.cloneMinecraft {
        transform: translateX(230px);
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