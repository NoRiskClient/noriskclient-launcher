<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api";
  import { appWindow } from "@tauri-apps/api/window";
  import { scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import SkinButton from "./SkinButton.svelte";
  import { listen } from "@tauri-apps/api/event";
  import LoadingScreen from "../loading/LoadingScreen.svelte";
  import SettingsModal from "../config/ConfigModal.svelte";
  import SkinScreen from "../skin/SkinScreen.svelte";
  import CapeScreen from "../cape/CapeScreen.svelte";
  import ModrinthScreen from "../modrinth/ModrinthScreen.svelte";
  import ClientLog from "../log/LogPopup.svelte";
  import NoRiskLogoColor from "../../images/norisk_logo_color.png";

  export let options;
  let branches = [];
  let currentBranchIndex = 0;
  let clientRunning;
  let fakeClientRunning = false;
  let refreshingAccount = false;

  let progressBarMax = 0;
  let progressBarProgress = 0;
  let progressBarLabel = "";
  let settingsShown = false;
  let clientLogShown = false;
  let showSkinScreen = false;
  let showSkinScreenHack = false;
  let showCapeScreen = false;
  let showCapeScreenHack = false;
  let showModrinthScreen = false;
  let showModrinthScreenHack = false;
  let log = [];

  listen("process-output", event => {
    log = [...log, event.payload];
  });

  listen("progress-update", event => {
    let progressUpdate = event.payload;
    console.log(event);

    switch (progressUpdate.type) {
      case "max": {
        progressBarMax = progressUpdate.value;
        break;
      }
      case "progress": {
        progressBarProgress = progressUpdate.value;
        break;
      }
      case "label": {
        progressBarLabel = progressUpdate.value;
        break;
      }
    }
  });

  function handleSwitchBranch(isLeft) {
    const totalBranches = branches.length;

    if (isLeft) {
      currentBranchIndex = (currentBranchIndex - 1 + totalBranches) % totalBranches;
    } else {
      currentBranchIndex = (currentBranchIndex + 1) % totalBranches;
    }
  }

  async function requestBranches() {
    await invoke("request_norisk_branches", {
      isExperimental: options.experimentalMode,
    })
      .then((result) => {
        const latestBranch = options.experimentalMode ? options.latestDevBranch : options.latestBranch;
        console.debug("Received Branches Latest Branch: " + latestBranch, result);
        branches = result;
        branches.sort(function(a, b) {
          if (a === latestBranch) {
            return -1;
          } else if (b === latestBranch) {
            return 1;
          } else {
            return a.localeCompare(b);
          }
        });
      })
      .catch((reason) => {
        alert(reason);
        console.error(reason);
      });
  }

  onMount(async () => {
    await requestBranches();
  });

  listen("client-exited", () => {
    clientRunning = false;
    fakeClientRunning = false;
    progressBarLabel = null;
    progressBarProgress = 0;
    progressBarMax = null;
  });

  listen("client-error", (e) => {
    clientLogShown = true;
    console.error(e.payload);
  });

  export async function runClient() {
    if (refreshingAccount) {
      console.error("Refreshing Account...");
      return;
    }
    refreshingAccount = true;
    await invoke("refresh_via_norisk", { loginData: options.accounts.find(obj => obj.uuid === options.currentUuid) })
      .then((account) => {
        console.debug("Current UUID", options.currentUuid);
        console.debug("Account UUID", account.uuid);
        // Index des vorhandenen Objekts mit derselben UUID suchen
        let existingIndex = options.accounts.findIndex(obj => obj.uuid === account.uuid);
        if (existingIndex !== -1) {
          console.debug("###Replaced Refreshed  Account");
          options.accounts[existingIndex] = account;
        } else {
          console.debug("###Added Refreshed Account");
          options.accounts.push(account);
        }

        options.store();
      })
      //TODO also aktueller stand ist dass das hier manchmal failen kann und deswegen kann man nicht refreshen haha einfach hoffen lol...
      .catch(e => console.error("###" + e));
    refreshingAccount = false;

    console.log("Client started");
    let branch = branches[currentBranchIndex];
    let installedMods = [];
    log = [];
    clientRunning = true;
    fakeClientRunning = true;

    if (options.experimentalMode) {
      options.latestDevBranch = branch;
    } else {
      options.latestBranch = branch;
    }

    options.store();

    await invoke("get_installed_mods", {
      branch: branch,
      options: options,
    }).then(result => {
      result.mods.forEach((mod) => {
        console.debug("mod", mod);
        installedMods.push(mod.value);
        mod.dependencies.forEach((dependency) => {
          installedMods.push(dependency.value);
        });
      });
      console.debug("Starting With Custom Mods", installedMods);
    });

    console.debug("Running Branch", branch);
    await invoke("run_client", {
      branch: branch,
      loginData: options.accounts.find(obj => obj.uuid === options.currentUuid),
      options: options,
      mods: installedMods,
    });
  }

  let dataFolderPath;
  invoke("default_data_folder_path").then(result => {
    dataFolderPath = result;
  }).catch(e => {
    alert("Failed to get data folder: " + e);
    console.error(e);
  });

  function preventSelection(event) {
    event.preventDefault();
  }

  function handleOpenSkinScreen() {
    showSkinScreenHack = true;
    setTimeout(() => {
      showSkinScreen = true;
    }, 300);
  }

  function handleOpenCapeScreen() {
    showCapeScreenHack = true;
    setTimeout(() => {
      showCapeScreen = true;
    }, 300);
  }

  function handleOpenModScreen() {
    showModrinthScreenHack = true;
    setTimeout(() => {
      showModrinthScreen = true;
    }, 300);
  }

  function home() {
    showSkinScreen = false;
    showSkinScreenHack = false;
    showCapeScreen = false;
    showCapeScreenHack = false;
    showModrinthScreen = false;
    showModrinthScreenHack = false;
  }

  function homeWhileClientRunning() {
    clientRunning = false;
    fakeClientRunning = true;
  }

  function backToLoadingScreen() {
    fakeClientRunning = false;
    setTimeout(() => {
      home()
      clientRunning = true;
    }, 100);
  }

  function closeWindow() {
    appWindow.close();
  }
</script>

<div class="black-bar" data-tauri-drag-region></div>
<div class="content">

  {#if showModrinthScreen}
    <ModrinthScreen on:home={home} bind:options bind:currentBranch={branches[currentBranchIndex]} />
  {/if}

  {#if showSkinScreen}
    <SkinScreen on:home={home} bind:options></SkinScreen>
  {/if}

  {#if showCapeScreen}
    <CapeScreen on:home={home} bind:options></CapeScreen>
  {/if}

  {#if settingsShown}
    <SettingsModal on:requestBranches={requestBranches} bind:options bind:showModal={settingsShown}
                   dataFolderPath={dataFolderPath}></SettingsModal>
  {/if}

  {#if clientLogShown}
    <ClientLog messages={log} on:hideClientLog={() => clientLogShown = false} />
  {/if}

  {#if clientRunning}
    <LoadingScreen bind:log bind:clientLogShown progressBarMax={progressBarMax}
                   progressBarProgress={progressBarProgress} progressBarLabel={progressBarLabel} on:home={homeWhileClientRunning}></LoadingScreen>
  {/if}

  {#if (!showSkinScreenHack && !showCapeScreenHack && !showModrinthScreenHack) && !clientRunning && !clientLogShown}
    {#if fakeClientRunning}
      <h1 class="back-to-loading-button" on:click={() => backToLoadingScreen()}>[BACK TO RUNNING GAME]</h1>
    {/if}
    <div transition:scale={{ x: 15, duration: 300, easing: quintOut }} class="settings-button-wrapper">
      <h1 on:click={() => settingsShown = true}>SETTINGS</h1>
      {#if options.accounts.length > 0}
        <h1 on:click={handleOpenSkinScreen}>SKIN</h1>
        <h1 on:click={handleOpenCapeScreen}>CAPES</h1>
      {/if}
      <h1 on:click={handleOpenModScreen}>MODS</h1>
      <h1 on:click={() => {options.toggleTheme()}}>{options.theme === "LIGHT" ? "DARK" : "LIGHT"}</h1>
      <h1 on:click={closeWindow}>QUIT</h1>
    </div>
    <img transition:scale={{ x: 15, duration: 300, easing: quintOut }} class="pokemon-title"
         src={NoRiskLogoColor}
         alt="Pokemon Title">
    <div class="branch-wrapper">
      <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
          on:selectstart={preventSelection} style="cursor: pointer"
          on:mousedown={preventSelection} class="nes-font switch"
          on:click={() => handleSwitchBranch(true)}>
        &lt;</h1>
      <section style="display:flex;justify-content:center">
        {#if refreshingAccount}
          <h1 class="nes-font" transition:scale={{ x: 15, duration: 300, easing: quintOut }} style="position:absolute">
            Loading Account...</h1>
        {:else}
          {#each branches as branch, i}
            {#if currentBranchIndex === i}
              <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
                  class="nes-font"
                  style="position:absolute"
                  on:selectstart={preventSelection}
                  on:mousedown={preventSelection}
              > {branches[currentBranchIndex].toUpperCase()} VERSION</h1>
            {/if}
          {/each}
        {/if}
      </section>
      <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
          on:selectstart={preventSelection}
          style="cursor: pointer" on:mousedown={preventSelection}
          class="nes-font switch" on:click={() => handleSwitchBranch(false)}>&gt;</h1>
    </div>
    <SkinButton on:launch={runClient} bind:options={options}></SkinButton>
    <div transition:scale={{ x: 15, duration: 300, easing: quintOut }} on:selectstart={preventSelection}
         on:mousedown={preventSelection} class="copyright">
      © 2000-2024 HGLabor/Friends Inc. v0.3.6
    </div>
  {/if}
</div>
<div class="black-bar" data-tauri-drag-region=""></div>

<style>
    .black-bar {
        width: 100%;
        height: 10vh;
        background-color: #151515;
    }

    .switch:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
    }

    .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
        gap: 20px;
        padding: 20px; /* Innenabstand für den Schlagschatten */
    }

    .branch-wrapper {
        display: flex;
        align-content: space-evenly;
        flex-direction: row;
        gap: 200px;
    }

    .pokemon-title {
        width: 80%;
        max-width: 400px;
        margin-bottom: 20px;
        image-rendering: pixelated;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
    }

    .copyright {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        margin-top: 0.3em;
        text-shadow: 1px 1px var(--hover-color-text-shadow);
        color: var(--hover-color);
        cursor: default;
    }

    .settings-button-wrapper {
        position: absolute;
        top: 5em;
        right: 0;
        padding: 10px;
        display: flex;
        flex-direction: column;
        align-items: end;
    }

    .settings-button-wrapper h1 {
        font-size: 10px;
        font-family: 'Press Start 2P', serif;
        margin-bottom: 1em;
        color: var(--secondary-color);
        text-shadow: 1px 1px var(--secondary-color-text-shadow);
        transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
    }

    .settings-button-wrapper h1:hover {
        color: var(--hover-color);
        text-shadow: 1px 1px var(--hover-color-text-shadow);
        transform: scale(1.2);
    }

    .back-to-loading-button {
        position: absolute;
        bottom: 1em; /* Abstand vom oberen Rand anpassen */
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .back-to-loading-button:hover {
        transform: scale(1.2);
    }
</style>
