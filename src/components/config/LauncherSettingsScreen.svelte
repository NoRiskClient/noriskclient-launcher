<script>
    import ConfigTextInput from "./inputs/ConfigTextInput.svelte";
    import ConfigSlider from "./inputs/ConfigSlider.svelte";
    import ConfigRadioButton from "./inputs/ConfigRadioButton.svelte";
    import ConfigFolderInput from "./inputs/ConfigFolderInput.svelte";
    import ConfigFileInput from "./inputs/ConfigFileInput.svelte";
    import McRealAppModal from "../mcRealApp/McRealAppModal.svelte";
    import { fetchOptions, launcherOptions, saveOptions } from "../../stores/optionsStore.js";
    import { preventSelection } from "../../utils/svelteUtils.js";
    import { invoke } from "@tauri-apps/api";
    import { addNotification } from "../../stores/notificationStore.js";
    import { onDestroy, onMount } from "svelte";
    import { fetchDefaultUserOrError, updateNoRiskToken, defaultUser } from "../../stores/credentialsStore.js";
    import { fetchBranches } from "../../stores/branchesStore.js";
    import { fetchProfiles } from "../../stores/profilesStore.js";
    import { featureWhitelist, noriskUser, noriskLog } from "../../utils/noriskUtils.js";
    import { startMicrosoftAuth } from "../../utils/microsoftUtils.js";
    import { getNoRiskToken } from "../../utils/noriskUtils.js";
    import { openConfirmPopup } from "../../utils/popupUtils.js";

    $: lightTheme = $launcherOptions?.theme === "LIGHT";
    let showMcRealAppModal = false;
    let totalSystemMemory = 0;
    let selectedMemory = 0;

    let keepLocalAssets = false;
    let keepLocalAssetsPernmission = ["ADMIN", "DEVELOPER", "DESIGNER"].includes($noriskUser?.rank?.toUpperCase());

    function toggleTheme() {
      $launcherOptions.toggleTheme();
      lightTheme = $launcherOptions.theme === "LIGHT";
    }


    async function confirmClearData() {
        openConfirmPopup({
            title: "Are you sure?",
            content: "Are you sure you want to erase all saved data?\nThis will delete all your worlds, mods and settings within the client.",
            onConfirm: clearData
        });
    }

    async function clearData() {
        invoke("clear_data", { options: $launcherOptions })
            .then(async () => {
                addNotification("Data cleared successfully!", "INFO");
                await fetchOptions();
                await fetchDefaultUserOrError(false);
                await fetchBranches();
                await fetchProfiles();
            })
            .catch((error) => {
                addNotification(error);
            });
    }

    async function toggleExperimentalMode() {
        if (!$launcherOptions.experimentalMode) {
            await saveOptions(false);
            if (getNoRiskToken() == null) {
                await startMicrosoftAuth();
            } else {
                await updateNoRiskToken($defaultUser);
                await fetchDefaultUserOrError(true);
            }
        } else {
            invoke("enable_experimental_mode", {
              credentials: $defaultUser
            }).then(async () => {
                noriskLog("Experimental mode enabled");
                $launcherOptions.experimentalMode = true;
                await saveOptions(false);
                if (getNoRiskToken() == null) {
                    await startMicrosoftAuth();
                } else {
                    await updateNoRiskToken($defaultUser);
                    await fetchDefaultUserOrError(true);
                }
            }).catch(async (e) => {
                $launcherOptions.experimentalMode = false;
                addNotification(`Failed to enable experimental mode: ${e}`);
            });
        }
    }

    async function toggleKeepLocalAssets() {
        if (keepLocalAssets) {
            invoke("enable_keep_local_assets").then(() => {
                keepLocalAssets = true;
            }).catch((e) => {
                keepLocalAssets = false;
                addNotification(`Failed to enable keep local assets: ${e}`);
            });
        } else {
            invoke("disable_keep_local_assets").then(() => {
                keepLocalAssets = false;
            }).catch((e) => {
                keepLocalAssets = true;
                addNotification(`Failed to disable keep local assets: ${e}`);
            });
        }
    }

    onMount(async () => {
        const totalBytes = await invoke("get_total_memory");
        totalSystemMemory = Math.round(totalBytes / (1024 * 1024 * 1024)); // Konvertiere Bytes in GB
        const memoryPercentage = $launcherOptions.memoryPercentage; // Verwende den Wert aus $launcherOptions
        selectedMemory = Math.round((memoryPercentage / 100) * totalSystemMemory); // Berechne den Speicher in GB
        noriskLog(`Total system memory: ${totalBytes} bytes (${totalSystemMemory} GB).`);
        noriskLog(`Selected memory: ${selectedMemory} GB (${memoryPercentage}%).`);
        
        if (keepLocalAssetsPernmission) {
            await invoke("get_keep_local_assets").then((value) => {
              keepLocalAssets = value;
            }).catch((e) => {
              addNotification(`Failed to get keep local assets: ${e}`);
            });
        }
    });

    onDestroy(async () => {
        //wir runden es weil wir es in der config als int speichern
        $launcherOptions.memoryPercentage = Math.round((selectedMemory / totalSystemMemory) * 100);
        noriskLog(`Selected memory: ${selectedMemory} GB (${$launcherOptions.memoryPercentage}%).`);
        await saveOptions();
    });
</script>

{#if showMcRealAppModal}
    <McRealAppModal bind:showModal={showMcRealAppModal} />
{/if}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div on:click|stopPropagation class="settings-container">
    <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>SETTINGS</h1>
    <hr>
    <div class="settings-wrapper">
    <ConfigRadioButton bind:value={$launcherOptions.keepLauncherOpen} text="Keep Launcher Open" />
    {#if $featureWhitelist.includes("EXPERIMENTAL_MODE") || $noriskUser?.isDev || $launcherOptions.experimentalMode == true}
        <ConfigRadioButton text="Experimental Mode" bind:value={$launcherOptions.experimentalMode} isExclusive={$noriskUser?.isDev} isExclusiveLabel={"Dev"} on:toggle={toggleExperimentalMode} />
    {/if}
    {#if keepLocalAssetsPernmission}
        <ConfigRadioButton text="Keep Local Assets" bind:value={keepLocalAssets} isExclusive={true} isExclusiveLabel={"Designer"} on:toggle={toggleKeepLocalAssets}/>
    {/if}
    <ConfigRadioButton text={`Theme: ${$launcherOptions.theme}`} bind:value={lightTheme} on:toggle={toggleTheme} />
    {#if $featureWhitelist.includes("MCREAL_APP")}
        <div class="mcreal-app-wrapper">
            <h1 class="title">MCReal App<p class="devOnly">(Alpha)</p></h1>
            <h1 class="button primary-text" on:click={() => { showMcRealAppModal = true; }}>Details</h1>
        </div>
    {/if}
    <div class="sliders">
        <ConfigSlider title="RAM" suffix="GB" min={2} max={totalSystemMemory} bind:value={selectedMemory} step={1} />
        <ConfigSlider title="Max Downloads" suffix="" min={1} max={50} bind:value={$launcherOptions.concurrentDownloads} step={1} />
    </div>
    <ConfigFileInput title="Custom Java Path" bind:value={$launcherOptions.customJavaPath} requiredFileName={["javaw", "java"]} defaultValue={""} />
    <ConfigTextInput title="Custom JVM args" bind:value={$launcherOptions.customJavaArgs} placeholder={"None"} />
    <ConfigFolderInput title="Data Folder" bind:value={$launcherOptions.dataPath} />
    <div class="clear-data-button-wrapper">
        <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={confirmClearData}>[CLEAR DATA]</p>
    </div>
    </div>
</div>

<style>
    .settings-container {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        overflow: hidden;
        height: 80vh;
        padding-top: 1em;
    }

    hr {
        width: 85%;
        border: 1px solid var(--font-color);
        margin-top: 1.5em;
    }

    .title {
        text-align: center;
        margin-top: 10px;
    }

    @keyframes fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .settings-wrapper {
        display: flex;
        flex-direction: column;
        margin-top: 2em;
        gap: 1.15em;
        width: 80vw;
        padding: 0px 2em 2em 2em;
        overflow-y: scroll;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        user-select: none;
        cursor: default;
    }

    .mcreal-app-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
    }

    .mcreal-app-wrapper > .title {
        display: flex;
        flex-direction: row;
        gap: 1em;
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }

    .mcreal-app-wrapper > .button {
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .mcreal-app-wrapper > .button:hover {
        transform: scale(1.15);
    }

    .devOnly {
      font-size: 12.5px;
      color: var(--dev-font-color);
      text-shadow: 1.25px 1.25px var(--dev-font-color-text-shadow);
    }

    .sliders {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        gap: 2em;
    }

    .clear-data-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        height: 3em;
        margin-top: 1.5em;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        text-shadow: 2px 2px #6e0000;
    }

    .clear-data-button-wrapper p {
        color: #ff0000;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .clear-data-button-wrapper p:hover {
        transform: scale(1.2);
    }
  </style>
