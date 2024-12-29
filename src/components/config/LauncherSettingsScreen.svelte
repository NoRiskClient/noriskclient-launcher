<script>
    import ConfigTextInput from "./inputs/ConfigTextInput.svelte";
    import ConfigSlider from "./inputs/ConfigSlider.svelte";
    import ConfigRadioButton from "./inputs/ConfigRadioButton.svelte";
    import ConfigFolderInput from "./inputs/ConfigFolderInput.svelte";
    import ConfigFileInput from "./inputs/ConfigFileInput.svelte";
    import McRealAppModal from "../mcRealApp/McRealAppModal.svelte";
    import ManageAccountsModal from "../account/AccountModal.svelte";
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
    import { openConfirmPopup, openLoadingPopup } from "../../utils/popupUtils.js";
    import { translations } from '../../utils/translationUtils.js';

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    $: lightTheme = $launcherOptions?.theme === "LIGHT";
    let showMcRealAppModal = false;
    let showManageAccountsModal = false;
    let totalSystemMemory = 0;
    let selectedMemory = 0;

    let keepLocalAssets = false;
    let keepLocalAssetsPernmission = ["ADMIN", "DEVELOPER", "DESIGNER"].includes($noriskUser?.rank?.toUpperCase());

    function toggleTheme() {
      $launcherOptions.toggleTheme();
      lightTheme = $launcherOptions.theme === "LIGHT";
    }

    async function confirmClearCache() {
        openConfirmPopup({
            title: lang.settings.popup.clearCache.title,
            content: lang.settings.popup.clearCache.content,
            onConfirm: clearCache
        });
    }

    async function clearCache() {
        invoke("clear_cache").then(async () => {
                addNotification(lang.settings.notification.clearCache.success, "INFO");
                await fetchOptions();
                await fetchDefaultUserOrError(false);
                await fetchBranches();
                await fetchProfiles();
                await startMicrosoftAuth();
            })
            .catch((error) => {
                addNotification(error);
            });
    }

    async function toggleExperimentalMode() {
        const closeLoadingPopup = openLoadingPopup({content: `Switching to ${$launcherOptions.experimentalMode ? 'experimental' : 'production'} mode...`});
        if (!$launcherOptions.experimentalMode) {
            await saveOptions(false);
            if (getNoRiskToken() == null) {
                await startMicrosoftAuth();
            } else {
                await updateNoRiskToken($defaultUser);
                await fetchDefaultUserOrError(true);
            }
            setTimeout(() => {
                closeLoadingPopup();
            }, 2000);
        } else {
            invoke("enable_experimental_mode", {
              credentials: $defaultUser
            }).then(async () => {
                noriskLog("Experimental mode enabled");
                $launcherOptions.experimentalMode = true;
                await saveOptions(false);
                if (getNoRiskToken() == null) {
                    await startMicrosoftAuth(closeLoadingPopup);
                } else {
                    await updateNoRiskToken($defaultUser);
                    await fetchDefaultUserOrError(true);
                    setTimeout(() => {
                        closeLoadingPopup();
                    }, 2000);
                }
            }).catch(async (err) => {
                $launcherOptions.experimentalMode = false;
                closeLoadingPopup();
                addNotification(lang.settings.notification.experimentalMode.error.replace("{error}", err));
            });
        }
    }

    async function toggleKeepLocalAssets() {
        if (keepLocalAssets) {
            invoke("enable_keep_local_assets").then(() => {
                keepLocalAssets = true;
                addNotification(lang.settings.notification.enableKeepLocalAssets.success, "INFO");
            }).catch((err) => {
                keepLocalAssets = false;
                addNotification(lang.settings.notification.enableKeepLocalAssets.error.replace("{error}", err));
            });
        } else {
            invoke("disable_keep_local_assets").then(() => {
                keepLocalAssets = false;
                addNotification(lang.settings.notification.disableKeepLocalAssets.success, "INFO");
            }).catch((err) => {
                keepLocalAssets = true;
                addNotification(lang.settings.notification.disableKeepLocalAssets.error.replace("{error}", err));
            });
        }
    }

    onMount(async () => {
        const totalBytes = await invoke("get_total_memory");
        totalSystemMemory = Math.round(totalBytes / (1024 * 1024 * 1024)); // Konvertiere Bytes in GB
        selectedMemory = Math.round($launcherOptions.memoryLimit / 1024); // Berechne den Speicher in GB
        noriskLog(`Total system memory: ${totalBytes} bytes (${totalSystemMemory} GB).`);
        noriskLog(`Selected memory: ${selectedMemory} GB.`);

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
        $launcherOptions.memoryLimit = selectedMemory * 1024;
        noriskLog(`Selected memory: ${selectedMemory} GB.`);
        await saveOptions();
    });
</script>

<McRealAppModal bind:showModal={showMcRealAppModal} />
<ManageAccountsModal bind:showModal={showManageAccountsModal} />
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div on:click|stopPropagation class="settings-container">
    <h1 class="nes-font title" on:selectstart={preventSelection} on:mousedown={preventSelection}>{lang.settings.title}</h1>
    <hr>
    <div class="settings-wrapper">
    <ConfigRadioButton bind:value={$launcherOptions.keepLauncherOpen} text={lang.settings.keepLauncherOpen} />
    <ConfigRadioButton bind:value={$launcherOptions.multipleInstances} text={lang.settings.multipleInstances} />
    {#if $featureWhitelist.includes("EXPERIMENTAL_MODE") || $noriskUser?.isDev || $launcherOptions.experimentalMode == true}
        <ConfigRadioButton text={lang.settings.experimentalMode} bind:value={$launcherOptions.experimentalMode} isExclusive={$noriskUser?.isDev} isExclusiveLabel={"Dev"} on:toggle={toggleExperimentalMode} />
    {/if}
    {#if keepLocalAssetsPernmission}
        <ConfigRadioButton text={lang.settings.keepLocalAssets} bind:value={keepLocalAssets} isExclusive={true} isExclusiveLabel={"Designer"} on:toggle={toggleKeepLocalAssets}/>
    {/if}
    <ConfigRadioButton text={lang.settings.theme.replace("{theme}", $launcherOptions.theme)} bind:value={lightTheme} on:toggle={toggleTheme} />
    {#if $featureWhitelist.includes("MCREAL_APP")}
        <div class="horizontal-wrapper">
            <h1 class="title">{lang.settings.mcRealApp.title}<p class="devOnly">(Alpha)</p></h1>
            <h1 class="button primary-text" on:click={() => { showMcRealAppModal = true; }}>{lang.settings.mcRealApp.button.details}</h1>
        </div>
    {/if}
    <div class="horizontal-wrapper">
        <h1 class="title">{lang.settings.accounts.title}</h1>
        <h1 class="button primary-text" on:click={() => { showManageAccountsModal = true; }}>{lang.settings.accounts.button.manage}</h1>
    </div>
    <div class="sliders">
        <ConfigSlider title={lang.settings.ram} suffix="GB" min={2} max={totalSystemMemory} bind:value={selectedMemory} step={1} />
        <ConfigSlider title={lang.settings.maxDownloads} suffix="" min={1} max={50} bind:value={$launcherOptions.concurrentDownloads} step={1} />
    </div>
    <ConfigFileInput title={lang.settings.customJavaPath} bind:value={$launcherOptions.customJavaPath} requiredFileName={["javaw", "java"]} defaultValue={""} />
    <ConfigTextInput title={lang.settings.customJavaArgs} bind:value={$launcherOptions.customJavaArgs} placeholder={lang.settings.placeholder.customJavaArgs} />
    <ConfigFolderInput title={lang.settings.dataFolder} bind:value={$launcherOptions.dataPath} />
    <div class="clear-cache-button-wrapper">
        <p class="red-text" on:selectstart={preventSelection} on:mousedown={preventSelection} on:click={confirmClearCache}>[{lang.settings.clearCacheButton}]</p>
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
        font-size: 30px;
        user-select: none;
        cursor: default;
    }

    .horizontal-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
    }

    .horizontal-wrapper > .title {
        display: flex;
        flex-direction: row;
        gap: 1em;
        font-size: 14px;
        color: var(--font-color);
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }

    .horizontal-wrapper > .button {
        font-size: 14px;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .horizontal-wrapper > .button:hover {
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

    .clear-cache-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        height: 3em;
        margin-top: 1.5em;
        font-size: 18px;
        text-shadow: 2px 2px #6e0000;
    }

    .clear-cache-button-wrapper p {
        color: #ff0000;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .clear-cache-button-wrapper p:hover {
        transform: scale(1.2);
    }
  </style>
