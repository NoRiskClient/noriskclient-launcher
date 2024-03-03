<script>
    import { scale } from "svelte/transition";
    import { quintOut } from "svelte/easing";
    import { createEventDispatcher } from "svelte";
    import VirtualList from "../utils/VirtualList.svelte";
    import Profile from "./Profile.svelte";
    import ProfileSettingsModal from "./ProfileSettingsModal.svelte";

    const dispatch = createEventDispatcher()

    export let branches;
    export let currentBranchIndex;
    export let options;
    export let allLauncherProfiles;
    let launcherProfiles = options.experimentalMode ? allLauncherProfiles.experimentalProfiles : allLauncherProfiles.mainProfiles;
    let activeProfile = () => options.experimentalMode ? allLauncherProfiles.selectedExperimentalProfiles[currentBranch()] : allLauncherProfiles.selectedMainProfiles[currentBranch()];
    let currentBranch = () => branches[currentBranchIndex];
    let profileById = (id) => launcherProfiles.find(p => p.id == id)
    let settingsOpen = false;
    let settingsProfile = {};
    let settingsCreateMode = false;

    let closed = false;

    function handleSwitchBranch(isLeft) {
        const totalBranches = branches.length;

        if (isLeft) {
            currentBranchIndex = (currentBranchIndex - 1 + totalBranches) % totalBranches;
        } else {
            currentBranchIndex = (currentBranchIndex + 1) % totalBranches;
        }

        launcherProfiles = launcherProfiles;
    }

    function openSettings(profile) {
        if (profile.branch) {
            settingsCreateMode = false;
            settingsProfile = profile;
        } else {
            settingsCreateMode = true;
            settingsProfile = {
                id: uuidv4(),
                name: '',
                branch: currentBranch(),
                mods: []
            }
        }
        console.log(settingsProfile);
        settingsOpen = true;
    }

    function selectProfile(profile) {
        console.log(profile);
        if (options.experimentalMode) {
            allLauncherProfiles.selectedExperimentalProfiles[profile.branch] = profile.id;
        } else {
            allLauncherProfiles.selectedMainProfiles[profile.branch] = profile.id;
        }
        launcherProfiles = options.experimentalMode ? allLauncherProfiles.experimentalProfiles : allLauncherProfiles.mainProfiles;
    }

    function uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function preventSelection(event) {
        event.preventDefault();
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 class="home-button" on:click={() => {closed = true; dispatch("home");}}>[BACK]</h1>
<div class="profiles-wrapper">
    {#if settingsOpen}
        <ProfileSettingsModal
        experimentalMode={options.experimentalMode}
        bind:settingsProfile
        bind:createMode={settingsCreateMode}
        bind:launcherProfiles={allLauncherProfiles}
        bind:showModal={settingsOpen}
        on:update={() => {launcherProfiles = options.experimentalMode ? allLauncherProfiles.experimentalProfiles : allLauncherProfiles.mainProfiles}}
        ></ProfileSettingsModal>
    {/if}
    {#if !closed}
        <div class="navbar">
            <div class="branch-wrapper">
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
                    on:selectstart={preventSelection} style="cursor: pointer"
                    on:mousedown={preventSelection} class="nes-font switch"
                    on:click={() => handleSwitchBranch(true)}
                    hidden={branches.length < 1 || options.currentUuid == null}>
                    &lt;</h1>
                <section style="display:flex;justify-content:center">
                    {#each branches as branch, i}
                        {#if currentBranchIndex === i}
                            <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
                                class="nes-font"
                                style="position:absolute"
                                on:selectstart={preventSelection}
                                on:mousedown={preventSelection}
                            > {branch.toUpperCase()} VERSION</h1>
                        {/if}
                    {/each}
                </section>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
                    on:selectstart={preventSelection}
                    style="cursor: pointer" on:mousedown={preventSelection}
                    class="nes-font switch" on:click={() => handleSwitchBranch(false)}
                    hidden={branches.length < 1 || options.currentUuid == null}>
                    &gt;</h1>
            </div>
        </div>
        <VirtualList height="27em" items={launcherProfiles.filter(p => p.branch == currentBranch())} let:item>
            <Profile profile={item} active={profileById(activeProfile()).id == item.id} on:settings={() => openSettings(item)} on:select={() => selectProfile(item)}></Profile>
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
    .branch-wrapper {
        display: flex;
        align-content: space-evenly;
        justify-content: center;
        flex-direction: row;
        gap: 200px;
        margin-bottom: 25px;
    }

    .switch:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
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
        text-shadow: 1px 1px var(--primary-color-text-shadow);
        cursor: default;
        margin-top: 15px;
    }

    .create-button:hover {
        transform: scale(1.2);
        transition-duration: 100ms;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
    }

    .home-button {
        position: absolute;
        bottom: 1em; /* Abstand vom oberen Rand anpassen */
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .home-button:hover {
        transform: scale(1.2);
    }
</style>
