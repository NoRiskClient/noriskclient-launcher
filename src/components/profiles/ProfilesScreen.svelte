<script>
	import { invoke } from '@tauri-apps/api/tauri';
  import VirtualList from "../utils/VirtualList.svelte";
  import Profile from "./Profile.svelte";
  import ProfileSettingsModal from "./ProfileSettingsModal.svelte";
  import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { fetchProfiles, profiles } from "../../stores/profilesStore.js";
  import BranchSwitcher from "../BranchSwitcher.svelte";
  import { v4 as uuidv4 } from "uuid";
  import { open } from "@tauri-apps/api/dialog";
  import { addNotification } from "../../stores/notificationStore.js";
  import { noriskLog } from "../../utils/noriskUtils.js";
  import { openConfirmPopup } from "../../utils/popupUtils.js";
  import { translations } from '../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  $: currentBranch = $branches[$currentBranchIndex];
  $: launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles;
  let activeProfile = () => $launcherOptions.experimentalMode ? $profiles.selectedExperimentalProfiles[currentBranch] : $profiles.selectedMainProfiles[currentBranch];
  let profileById = (id) => launcherProfiles.find(p => p.id === id);
  let settingsOpen = false;
  let settingsProfile = {};
  let settingsCreateMode = false;

  let closed = false;

  function openSettings(profile) {
    if (profile.branch) {
      settingsCreateMode = false;
      settingsProfile = profile;
    } else {
      settingsCreateMode = true;
      settingsProfile = {
        id: uuidv4(),
        name: "",
        branch: currentBranch,
        mods: [],
      };
    }
    settingsOpen = true;
  }

  function selectProfile(profile) {
    noriskLog("Selected profile: " + profile.name);
    if ($launcherOptions.experimentalMode) {
      $profiles.selectedExperimentalProfiles[profile.branch] = profile.id;
    } else {
      $profiles.selectedMainProfiles[profile.branch] = profile.id;
    }
    $profiles.store();
    launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles;
  }

  async function exportProfile(profileId) {
    openConfirmPopup({
      title: lang.profiles.popup.export.title,
      content: lang.profiles.popup.export.content.replace("{profile}", profileById(profileId).name),
      confirmButton: lang.profiles.popups.export.buttons.confirm,
      closeButton: lang.profiles.popups.export.buttons.close,
      onConfirm: async () => {
        await invoke("export_profile_and_open_explorer", { profileId }).then(() => {
          noriskLog("Exported profile: " + profileId);
          addNotification(lang.profiles.notification.export.success, "INFO");
        }).catch(err => {
          noriskLog("Failed to export profile: " + profileId);
          noriskLog(err);
          addNotification(lang.profiles.notification.export.error.replace("{error}", err));
        });
      }
    })
  }

  async function cloneProfile(profile) {
    noriskLog("Cloning profile: " + profile.name);
    
    let profileClone = {
      id: uuidv4(),
      name: `${profile.name} (cloned)`,
      branch: profile.branch,
      mods: profile.mods
    };

    if ($launcherOptions.experimentalMode) {
      $profiles.experimentalProfiles.push(profileClone);
    } else {
      $profiles.mainProfiles.push(profileClone);
    }

    $profiles.store()
    launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles;

    addNotification(lang.profiles.notification.clone.success.replace("{profile}", profile.name), "INFO")
  }

  async function importProfile() {
    try {
      const location = await open({
        defaultPath: "/",
        multiple: false,
        filters: [{ name: lang.profiles.import.filterName, extensions: ["noriskprofile"] }],
      });

      if (!location) {
        return;
      }

      let splitter = "";
      if (location.split("/")[0] == "") {
        splitter = "/";
      } else {
        splitter = "\\";
      }
      const fileName = location.split(splitter)[location.split(splitter).length - 1];

      if (!fileName.endsWith(".noriskprofile")) {
        addNotification(lang.profiles.notification.import.invalidFileExtentionError.replace("{fileName}", fileName));
        return;
      }

      noriskLog(`Importing profile ${fileName}`);
      await invoke("import_launcher_profile", { fileLocation: location }).then(() => {
        addNotification(lang.profiles.notification.import.success.replace("{profile}", fileName.replace('.noriskprofile', '')), "INFO");
        fetchProfiles();
      }).catch((error) => {
        addNotification(lang.profiles.notification.import.failedToImportError.replace("{profile}", fileName).replace("{error}", error));
      });
    } catch (error) {
      addNotification(lang.profiles.notification.import.failedToSelectFile.replace("{error}", error));
    }
  }
</script>

<div class="profiles-wrapper">
  {#if settingsOpen}
    <ProfileSettingsModal
      experimentalMode={$launcherOptions.experimentalMode}
      bind:settingsProfile
      bind:createMode={settingsCreateMode}
      bind:launcherProfiles={$profiles}
      bind:showModal={settingsOpen}
      on:update={() => {launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles}}
    />
  {/if}
  {#if !closed}
    <BranchSwitcher allowBranchSwitching={false} />
    <hr class="devider">
    <VirtualList height="27em" items={launcherProfiles?.filter(p => p.branch == currentBranch) ?? []} let:item>
      <Profile profile={item} active={profileById(activeProfile()).id == item.id} on:settings={() => openSettings(item)}
               on:select={() => selectProfile(item)} on:export={() => exportProfile(item.id)} on:clone={() => cloneProfile(item)} />
    </VirtualList>
    <div class="create-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="create-button green-text" on:click={openSettings}>{lang.profiles.buttons.createProfile}</h1>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="create-button green-text" on:click={importProfile}>{lang.profiles.buttons.importProfile}</h1>
    </div>
  {/if}
</div>

<style>
    .profiles-wrapper {
        display: flex;
        align-items: center;
        justify-content: space-evenly;
        flex-direction: column;
        height: 100%;
    }

    .devider {
      width: 90%;
      height: 1px;
      opacity: 0.5;
    }

    .create-wrapper {
        display: flex;
        flex-direction: row;
        gap: 5em;
        justify-content: center;
        width: 100%;
    }

    .create-button {
        transition-duration: 100ms;
        font-size: 18px;
        cursor: pointer;
    }

    .create-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }
</style>
