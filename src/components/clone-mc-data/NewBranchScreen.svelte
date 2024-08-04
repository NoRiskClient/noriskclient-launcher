<script>
    import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import { pop, replace } from "svelte-spa-router";
    import VirtualList from "../utils/VirtualList.svelte";
    import NewBranchMinecraftPathPopup from "./NewBranchMinecraftPathPopup.svelte";
    import { invoke } from "@tauri-apps/api/tauri";
    import { onMount } from "svelte";
    import { runClient } from "../../utils/noriskUtils.js";
    import { addNotification } from "../../stores/notificationStore.js";

    const dontCloneDataText = "Don't clone any data";
    const cloneMinecraftDataText = "Clone Minecraft Data";

    let availableBranches = [];
    let path = '';
    let showCloneMinecraftDataPopup = false;

    onMount(() => {
        invoke("get_branches_from_folder").then(branches_from_folder => {
            availableBranches = branches_from_folder.filter(b => b != $branches[$currentBranchIndex]).map(b => b == ($launcherOptions.experimentalMode ? $launcherOptions.latestDevBranch : $launcherOptions.latestBranch) ? `${b} (last played)` : b)
            availableBranches.push(cloneMinecraftDataText);
            availableBranches.push(dontCloneDataText);
        }).catch(err => {
            console.error("Error getting branches", err);
            alert("An error occurred while getting the branches: \n" + err);
            addNotification("An error occurred while getting the branches: " + err);
        });
    });

    async function cloneBranchData(branch) {
        if (branch == null) {
            pop();
            runClient($branches[$currentBranchIndex], true);
            return;
        }

        console.log("Copying data from branch", branch);
        replace("/copy-mc-data-progress");
        invoke("copy_branch_data", { oldBranch: branch, newBranch: $branches[$currentBranchIndex] }).then(() => {
            console.log("Data copied successfully!");
            pop();
            runClient($branches[$currentBranchIndex], true);
        }).catch(err => {
            console.error("Error copying data", err);
            addNotification("An error occurred while copying the data: " + err);
        });
    }

    async function openCloneMinecraftDataPopup() {
        invoke("get_default_mc_folder").then(res => {
            path = res;
            showCloneMinecraftDataPopup = true;
        }).catch(err => {
            path = null;
            console.error("Error getting default minecraft folder", err);
            addNotification("An error occurred while getting the default minecraft folder: " + err);
        });
    }

    async function cloneMinecraftData() {
        if (path == '') {
            addNotification("An error occurred while getting the default minecraft folder. Please try again.");
            return;
        }

        console.log("Copying minecraft data from", path);
        replace("/copy-mc-data-progress");
        invoke("copy_mc_data", { path: path, branch: $branches[$currentBranchIndex] }).then(() => {
            console.log("Minecraft data copied successfully!");
            pop();
            runClient($branches[$currentBranchIndex], true);
        }).catch(err => {
            console.error("Error copying minecraft data", err);
            addNotification("An error occurred while copying the minecraft data: " + err);
        });
    }
</script>

{#if showCloneMinecraftDataPopup}
    <NewBranchMinecraftPathPopup bind:showModal={showCloneMinecraftDataPopup} bind:path={path} on:clone={cloneMinecraftData} />
{/if}
<div class="container">
    <div class="header">
        <h1>New Branch Detected</h1>
        <p>You have just started "{$branches[$currentBranchIndex]}" for the fist time.<br>To make the transition cleaner and faster you can copy your settings and servers from other branches below.</p>
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