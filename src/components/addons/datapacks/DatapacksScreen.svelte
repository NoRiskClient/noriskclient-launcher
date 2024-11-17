<script>
  import { invoke } from "@tauri-apps/api";
  import { removeFile } from "@tauri-apps/api/fs";
  import { open } from "@tauri-apps/api/dialog";
  import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
  import DatapackItem from "./DatapackItem.svelte";
  import { tick, onDestroy, onMount } from "svelte";
  import { watch } from "tauri-plugin-fs-watch-api";
  import { listen } from "@tauri-apps/api/event";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";
  import { launcherOptions } from "../../../stores/optionsStore.js";
  import { profiles } from "../../../stores/profilesStore.js";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { addNotification } from "../../../stores/notificationStore.js";
  import { getNoRiskToken, noriskUser, noriskLog } from "../../../utils/noriskUtils.js";
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  $: currentBranch = $branches[$currentBranchIndex];
  $: options = $launcherOptions;
  $: launcherProfiles = $profiles;
  export let world;
  let launcherProfile = null;
  let customDatapacks = [];
  let featuredDatapacks = null;
  let blacklistedDatapacks = [];
  let datapacks = [];
  let launchManifest = null;
  let searchterm = "";
  let filterterm = "";
  let currentTabIndex = 0;
  let loadMoreButton = false;
  let fileWatcher;
  let listScroll = 0;

  let search_offset = 0;
  let search_limit = 30;
  let search_index = "relevance";

  let filterCategories = [];
  let filters = {};

  let lastFileDrop = -1;
  listen("tauri://file-drop", files => {
    if (currentTabIndex != 1) {
      return;
    }
    const time = Date.now();
    if (time - lastFileDrop < 1000) return;
    lastFileDrop = time;
    let todo = new Set();
    files.payload.forEach(l => todo.add(l));
    installCustomDatapacks(todo);
  });

  // check if an element exists in array using a comparer function
  // comparer : function(currentElement)
  Array.prototype.inArray = function(comparer) {
    for (let i = 0; i < this.length; i++) {
      if (comparer(this[i])) return true;
    }
    return false;
  };

  // adds an element to the array if it does not already exist using a comparer
  // function
  Array.prototype.pushIfNotExist = function(element, comparer) {
    if (!this.inArray(comparer)) {
      this.push(element);
    }
  };

  async function updateDatapacks(newDatapacks) {
    datapacks = newDatapacks;
    
    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }
  async function updateProfileDatapacks(newDatapacks) {
    launcherProfiles.addons[currentBranch].datapacks = newDatapacks;
    
    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }

  async function getLaunchManifest() {
    await invoke("get_launch_manifest", {
      branch: currentBranch,
      noriskToken: getNoRiskToken(),
      uuid: $defaultUser.id,
    }).then((result) => {
      console.debug("Launch Manifest", result);
      launchManifest = result;
      getCustomDatapacksFilenames();
      createFileWatcher();
    }).catch((error) => {
      addNotification("Failed to get launch manifest: " + error);
    });
  }

  async function getBlacklistedDatapacks() {
    await invoke("get_blacklisted_datapacks").then((result) => {
      console.debug("Blacklisted Datapacks", result);
      blacklistedDatapacks = result;
    }).catch((error) => {
      console.error(error);
    });
  }

  async function getCustomDatapacksFilenames() {
    await invoke("get_custom_datapacks_filenames", {
      options: options,
      branch: launchManifest.build.branch,
      installedDatapacks: launcherProfiles.addons[currentBranch].datapacks,
      world: world,
    }).then((fileNames) => {
      console.debug("Custom Datapacks", fileNames);
      customDatapacks = fileNames;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function installDatapack(datapack) {
    datapack.loading = true;
    updateDatapacks(datapacks);
    await invoke("get_datapack", {
      slug: datapack.slug,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["datapack"]`,
      world: world,
    }).then(async (result) => {
      launcherProfiles.addons[currentBranch].datapacks.pushIfNotExist(result, function(e) {
        return e.slug === result.slug && e.world_name === world;
      });
      updateDatapacks(datapacks);
      updateProfileDatapacks(launcherProfiles.addons[currentBranch].datapacks);
      launcherProfiles.store();

      await invoke("download_datapack", {
        options: $launcherOptions,
        branch: launchManifest.build.branch,
        world: world,
        datapack: result,
      }).then(() => {
        datapack.loading = false;
        updateDatapacks(datapacks);
      }).catch((error) => {
        addNotification(error);
      });
    }).catch((error) => {
      addNotification(error);
    });
  }

  function checkIfRequiredOrInstalled(slug) {
    if (launcherProfiles.addons[currentBranch].datapacks.some((datapack) => {
      return datapack.slug.toUpperCase() === slug.toUpperCase() && datapack.world_name === world;
    })) {
      return "INSTALLED";
    }
    return "INSTALL";
  }

  async function getFeaturedDatapacks() {
    await invoke("get_featured_datapacks", {
      branch: currentBranch,
      mcVersion: launchManifest.build.mcVersion,
    }).then((result) => {
      console.debug("Featured Datapacks", result);
      result.forEach(datapack => datapack.featured = true);
      featuredDatapacks = result;
    }).catch((error) => {
      addNotification(error);
      featuredDatapacks = [];
    });
  }

  async function searchDatapacks() {
    let oldDatapacks = datapacks;
    
    if (searchterm == "" && search_offset === 0) {
      if (featuredDatapacks == null) {
        await getFeaturedDatapacks();
      }
      oldDatapacks = featuredDatapacks;
    }
      
    // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
    // Update: Ich habe ne eigene Virtual List gemacht 📉
    updateDatapacks([]);

    await invoke("search_datapacks", {
      params: {
        facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:datapack"], ["categories:'datapack'"]${Object.values(filters).filter(filter => filter.enabled).length > 0 ? ", " : ""}${Object.values(filters).filter(filter => filter.enabled).map(filter => `["categories:'${filter.id}'"]`).join(", ")}]`,
        index: search_index,
        limit: search_limit,
        offset: search_offset,
        query: searchterm,
      },
    }).then((result) => {
      console.debug("Search Datapack Result", result);

      loadMoreButton = result.hits.length >= search_limit;

      if (!$noriskUser?.isDev) {
        console.debug("Filtering Blacklisted Datapacks", blacklistedDatapacks);
        const length = result.hits.length;
        result.hits = result.hits.filter(datapack => !blacklistedDatapacks.includes(datapack.slug));
        console.debug(`Filtered ${length - result.hits.length} Blacklisted Datapacks`);
      }
      result.hits.forEach(datapack => {
        datapack.featured = featuredDatapacks.find(featuredDatapack => featuredDatapack.slug === datapack.slug);
        datapack.blacklisted = blacklistedDatapacks.includes(datapack.slug);
      });
      if (result.hits.length === 0) {
        updateDatapacks(null);
      } else if ((search_offset == 0 && searchterm != "") || Object.values(filters).length > 0) {
        updateDatapacks(result.hits);
      } else {
        updateDatapacks([...oldDatapacks, ...result.hits.filter(datapack => searchterm != "" || !featuredDatapacks.some((element) => element.slug === datapack.slug))]);
      }
    }).catch((error) => {
      addNotification(error);
    });
  }

  function loadMore() {
    search_offset += search_limit;
    searchDatapacks();
  }

  async function deleteInstalledDatapack(datapack) {
    let index = launcherProfiles.addons[currentBranch].datapacks.findIndex((element) => {
      return element.slug.toUpperCase() === (datapack?.slug ?? datapack).toUpperCase() && element.world_name === world;
    });

    if (index !== -1) {
      launcherProfiles.addons[currentBranch].datapacks.splice(index, 1);
      updateDatapacks(datapacks);

      await invoke("get_datapack", {
        slug: datapack.slug,
        params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["datapack"]`,
        world: world,
      }).then(async datapackVersion => {
        deleteDatapackFile(datapackVersion.file_name);
        
        launcherProfiles.store();
        const prev = [datapacks, launcherProfiles.addons[currentBranch].datapacks];
        updateDatapacks([]);
        updateProfileDatapacks([]);
        await tick();
        updateDatapacks(prev[0]);
        updateProfileDatapacks(prev[1]);
      }).catch((error) => {
        addNotification(error);
      });
    } else {
      deleteDatapackFile(datapack);
    }
  }

  async function deleteDatapackFile(filename) {
    await invoke("delete_datapack_file", {
      fileName: filename,
      options: options,
      branch: launchManifest.build.branch,
      world: world,
    }).then(async () => {
      getCustomDatapacksFilenames();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function createFileWatcher() {
    await invoke("get_custom_datapacks_folder", {
      options: options,
      branch: launchManifest.build.branch,
      world: world,
    }).then(async (folder) => {
      console.debug("File Watcher Folder", folder);
      // can also watch an array of paths
      fileWatcher = await watch(
        folder,
        getCustomDatapacksFilenames,
        { recursive: true },
      );
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function handleSelectCustomDatapacks() {
    try {
      const locations = await open({
        defaultPath: "/",
        multiple: true,
        filters: [{ name: "Datapacks", extensions: ["zip"] }],
      });
      if (locations instanceof Array) {
        installCustomDatapacks(locations);
      }
    } catch (error) {
      addNotification(lang.addons.datapacks.notification.failedToSelectCustomDatapacks.replace("{error}", error));
    }
  }

  async function installCustomDatapacks(locations) {
    locations.forEach(async (location) => {
      if (!location.endsWith(".zip")) {
        return;
      }
      let splitter = "";
      if (location.split("/")[0] == "") {
        splitter = "/";
      } else {
        splitter = "\\";
      }
      const fileName = location.split(splitter)[location.split(splitter).length - 1];
      noriskLog(`Installing custom Datapack ${fileName}`);
      await invoke("save_custom_datapack_to_folder", {
        options: options,
        branch: launchManifest.build.branch,
        file: { name: fileName, location: location },
        world: world,
      }).catch((error) => {
        addNotification(error);
      });
      getCustomDatapacksFilenames();
    });
  }

  async function load() {
    if (options.experimentalMode) {
      const selectedProfile = launcherProfiles.selectedExperimentalProfiles[currentBranch];
      launcherProfile = launcherProfiles.experimentalProfiles.find(p => p.id == selectedProfile);
      if (!launcherProfile) {
        launcherProfiles.experimentalProfiles.splice(launcherProfiles.experimentalProfiles.indexOf(launcherProfiles.experimentalProfiles.find(p => p.id == selectedProfile)), 1);
        launcherProfile = launcherProfiles.experimentalProfiles.find(p => p.name == `${currentBranch} - Default`);
        launcherProfiles.selectedExperimentalProfiles[currentBranch] = launcherProfile.id;
        launcherProfiles.store();
      }
    } else {
      const selectedProfile = launcherProfiles.selectedMainProfiles[currentBranch];
      launcherProfile = launcherProfiles.mainProfiles.find(p => p.id == selectedProfile);
      if (!launcherProfile) {
        launcherProfiles.mainProfiles.splice(launcherProfiles.mainProfiles.indexOf(launcherProfiles.mainProfiles.find(p => p.id == selectedProfile)), 1);
        launcherProfile = launcherProfiles.mainProfiles.find(p => p.name == `${currentBranch} - Default`);
        launcherProfiles.selectedMainProfiles[currentBranch] = launcherProfile.id;
        launcherProfiles.store();
      }
    }
    await getLaunchManifest();
    await getBlacklistedDatapacks();
    await searchDatapacks();
  }

  onMount(() => {
    filterCategories = [
      {
        type: lang.addons.datapacks.filters.categories.title,
        entries: [
          { id: "adventure", name: lang.addons.datapacks.filters.categories.adventure },
          { id: "cursed", name: lang.addons.datapacks.filters.categories.cursed },
          { id: "decoration", name: lang.addons.datapacks.filters.categories.decoration },
          { id: "economy", name: lang.addons.datapacks.filters.categories.economy },
          { id: "equipment", name: lang.addons.datapacks.filters.categories.equipment },
          { id: "food", name: lang.addons.datapacks.filters.categories.food },
          { id: "game-mechanics", name: lang.addons.datapacks.filters.categories.gameMechanics },
          { id: "library", name: lang.addons.datapacks.filters.categories.library },
          { id: "magic", name: lang.addons.datapacks.filters.categories.magic },
          { id: "management", name: lang.addons.datapacks.filters.categories.management },
          { id: "minigame", name: lang.addons.datapacks.filters.categories.minigame },
          { id: "mobs", name: lang.addons.datapacks.filters.categories.mobs },
          { id: "optimization", name: lang.addons.datapacks.filters.categories.optimization },
          { id: "social", name: lang.addons.datapacks.filters.categories.social },
          { id: "storage", name: lang.addons.datapacks.filters.categories.storage },
          { id: "technology", name: lang.addons.datapacks.filters.categories.technology },
          { id: "transportation", name: lang.addons.datapacks.filters.categories.transportation },
          { id: "utility", name: lang.addons.datapacks.filters.categories.utility },
          { id: "worldgen", name: lang.addons.datapacks.filters.categories.worldgen },
        ],
      },
    ];
    load();
  });

  onDestroy(() => {
    fileWatcher = null;
  });
</script>

<div class="modrinth-wrapper">
  <div class="navbar">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>{lang.addons.global.navbar.discover}</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>{lang.addons.global.navbar.installed}</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleSelectCustomDatapacks}>{lang.addons.global.navbar.button.custom}</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            listScroll = 0;
            searchDatapacks();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder={lang.addons.datapacks.searchbar.modrinth.placeholder} />
    {#if datapacks !== null && datapacks.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...datapacks, loadMoreButton ? 'LOAD_MORE_DATAPACKS' : null] as item}
          {#if item === 'LOAD_MORE_DATAPACKS'}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="load-more-button" on:click={loadMore}><p class="primary-text">LOAD MORE</p></div>
          {:else if item != null}
            <DatapackItem text={checkIfRequiredOrInstalled(item.slug)}
                on:delete={() => deleteInstalledDatapack(item)}
                on:install={() => installDatapack(item)}
                type="RESULT"
                datapack={item}
              />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{datapacks == null ? lang.addons.datapacks.noDatapacksFound : lang.addons.global.loading}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={async () => {
      const prev = launcherProfiles.addons[currentBranch].datapacks;
      launcherProfiles.addons[currentBranch].datapacks = [];
      await tick();
      launcherProfiles.addons[currentBranch].datapacks = prev;
    }} bind:searchTerm={filterterm} placeHolder={lang.addons.datapacks.searchbar.installed.placeholder} />
    {#if launcherProfiles.addons[currentBranch].datapacks.length > 0 || customDatapacks.length > 0}
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...customDatapacks,...launcherProfiles.addons[currentBranch].datapacks].filter((datapack) => {
            let name = (datapack?.title ?? datapack).toUpperCase()
            return (datapack?.title != null || name.endsWith(".ZIP")) && name.includes(filterterm.toUpperCase()) && (datapack?.world_name == undefined || datapack.world_name === world)
          }).sort((a, b) => (a?.title ?? a).localeCompare(b?.title ?? b)) as item}
          {#if (typeof item === 'string' || item instanceof String)}
            <DatapackItem text="INSTALLED"
              on:delete={() => deleteInstalledDatapack(item)}
              type="CUSTOM"
              datapack={item}
            />
          {:else}
            <DatapackItem text="INSTALLED"
              on:delete={() => deleteInstalledDatapack(item)}
              type="INSTALLED"
              datapack={item}
            />
          {/if}
        {/each}
      </div>
      {:else}
      <h1 class="loading-indicator">{launcherProfiles.addons[currentBranch].datapacks.length < 1 ? lang.addons.datapacks.noDatapacksInstalled : lang.addons.global.loading}</h1>
    {/if}
  {/if}
</div>

<style>
    .navbar {
        display: flex;
        gap: 1em;
        justify-content: center;
    }

    .navbar h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .navbar h1:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
        transform: scale(1.05);
    }

    .navbar h2 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .loading-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin-top: 200px;
    }

    .load-more-button {
        display: flex;
        flex-direction: row;
        justify-content: center;
        margin-top: 20px;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: pointer;
        transition-duration: 150ms;
    }

    .load-more-button:hover {
        transform: scale(1.2);
    }

    .modrinth-wrapper {
        padding: 1em;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.7em;
    }

    .scrollList {
        height: 30em;
        position: relative;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling:touch;
        display: block;
    }
</style>
