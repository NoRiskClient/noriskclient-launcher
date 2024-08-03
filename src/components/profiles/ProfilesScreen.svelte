<script>
  import { createEventDispatcher } from "svelte";
  import VirtualList from "../utils/VirtualList.svelte";
  import Profile from "./Profile.svelte";
  import ProfileSettingsModal from "./ProfileSettingsModal.svelte";
  import { branches, currentBranchIndex } from "../../stores/branchesStore.js";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { fetchProfiles, profiles } from "../../stores/profilesStore.js";
  import BranchSwitcher from "../BranchSwitcher.svelte";
  import { v4 as uuidv4 } from "uuid";

  const dispatch = createEventDispatcher();

  currentBranchIndex.subscribe(async value => {
    await fetchProfiles();
  });

  $: currentBranch = $branches[$currentBranchIndex];
  let launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles;
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
    console.log("Selected Profile:", profile);
    if ($launcherOptions.experimentalMode) {
      $profiles.selectedExperimentalProfiles[profile.branch] = profile.id;
    } else {
      $profiles.selectedMainProfiles[profile.branch] = profile.id;
    }
    $profiles.store();
    launcherProfiles = $launcherOptions.experimentalMode ? $profiles.experimentalProfiles : $profiles.mainProfiles;
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
    ></ProfileSettingsModal>
  {/if}
  {#if !closed}
    <BranchSwitcher />
    <VirtualList height="27em" items={launcherProfiles.filter(p => p.branch == currentBranch)} let:item>
      <Profile profile={item} active={profileById(activeProfile()).id == item.id} on:settings={() => openSettings(item)}
               on:select={() => selectProfile(item)}></Profile>
    </VirtualList>
    <div class="create-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="create-button"
          on:click={openSettings}>
        CREATE PROFILE
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

    .create-wrapper {
        display: flex;
        justify-content: center;
    }

    .create-button {
        color: #00ff00;
        text-shadow: 2px 2px #086b08;
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
