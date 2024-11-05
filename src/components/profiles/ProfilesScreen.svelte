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

  currentBranchIndex.subscribe(async _ => {
    await fetchProfiles();
  });

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
    await invoke("export_profile_and_open_explorer", { profileId }).then(() => {
      noriskLog("Exported profile: " + profileId);
      addNotification("Profile exported successfully!", "INFO");
    }).catch(err => {
      noriskLog("Failed to export profile: " + profileId);
      noriskLog(err);
      addNotification("Failed to export profile: " + err);
    });
  }

  async function importProfile() {
    try {
      const location = await open({
        defaultPath: "/",
        multiple: false,
        filters: [{ name: "Import Progile", extensions: ["noriskprofile"] }],
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
        addNotification(`Cannot install ${fileName}!<br><br>Only .noriskprofile files are supported.`);
        return;
      }

      noriskLog(`Importing profile ${fileName}`);
      await invoke("import_launcher_profile", { fileLocation: location }).then(() => {
        addNotification(`Successfully imported profile ${fileName}`, "INFO");
        fetchProfiles();
      }).catch((error) => {
        addNotification(`Failed to import profile ${fileName}: ${error}`);
      });
    } catch (error) {
      addNotification("Failed to select file using dialog: " + error);
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
               on:select={() => selectProfile(item)} on:export={() => exportProfile(item.id)} />
    </VirtualList>
    <div class="create-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="create-button green-text" on:click={openSettings}>
        CREATE PROFILE
      </h1>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="create-button green-text" on:click={importProfile}>
        IMPORT PROFILE
      </h1>
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
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        cursor: pointer;
    }

    .create-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }
</style>
