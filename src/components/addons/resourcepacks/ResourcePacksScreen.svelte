<script>
  import { invoke } from "@tauri-apps/api";
  import { removeFile } from "@tauri-apps/api/fs";
  import { open } from "@tauri-apps/api/dialog";
  import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
  import ResourcePackItem from "./ResourcePackItem.svelte";
  import { tick, onDestroy, onMount } from "svelte";
  import { watch } from "tauri-plugin-fs-watch-api";
  import { listen } from "@tauri-apps/api/event";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";
  import { launcherOptions } from "../../../stores/optionsStore.js";
  import { profiles } from "../../../stores/profilesStore.js";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { getNoRiskToken, noriskUser, noriskLog } from "../../../utils/noriskUtils.js";
  import { addNotification } from "../../../stores/notificationStore.js";
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  $: currentBranch = $branches[$currentBranchIndex];
  $: options = $launcherOptions;
  $: launcherProfiles = $profiles;
  let launcherProfile = null;
  let customResourcePacks = [];
  let featuredResourcePacks = null;
  let blacklistedResourcePacks = [];
  let resourcePacks = [];
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

    installCustomResourcePacks(todo);
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

  async function updateResourcePacks(newResourcePacks) {
    resourcePacks = newResourcePacks;
    
    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }
  async function updateProfileResourcePacks(newResourcePacks) {
    launcherProfiles.addons[currentBranch].resourcePacks = newResourcePacks;
    
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
      getCustomResourcePacksFilenames();
      createFileWatcher();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function getBlacklistedResourcePacks() {
    await invoke("get_blacklisted_resourcepacks").then((resourcePacks) => {
      console.debug("Blacklisted ResourcePacks", resourcePacks);
      blacklistedResourcePacks = resourcePacks;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function getCustomResourcePacksFilenames() {
    await invoke("get_custom_resourcepacks_filenames", {
      options: options,
      installedResourcepacks: launcherProfiles.addons[currentBranch].resourcePacks,
      branch: launchManifest.build.branch,
    }).then((fileNames) => {
      console.debug("Custom ResourcePacks", fileNames);
      customResourcePacks = fileNames;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function installResourcePack(resourcePack) {
    resourcePack.loading = true;
    updateResourcePacks(resourcePacks);
    await invoke("get_resourcepack", {
      slug: resourcePack.slug,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]`,
    }).then(async (result) => {
      launcherProfiles.addons[currentBranch].resourcePacks.pushIfNotExist(result, function(e) {
        return e.slug === result.slug;
      });
      updateProfileResourcePacks(launcherProfiles.addons[currentBranch].resourcePacks);
      launcherProfiles.store();

      await invoke("download_resourcepack", {
        options: options,
        branch: launchManifest.build.branch,
        resourcepack: result,
      }).then(async () => {
        resourcePack.loading = false;
        updateResourcePacks(resourcePacks);
      }).catch((error) => {
        addNotification(error);
      });
    }).catch((error) => {
      addNotification(error);
    });
  }

  function checkIfRequiredOrInstalled(slug) {
    if (launcherProfiles.addons[currentBranch].resourcePacks.some((resourcePack) => {
      return resourcePack.slug.toUpperCase() === slug.toUpperCase();
    })) {
      return "INSTALLED";
    }
    return "INSTALL";
  }

  async function getFeaturedResourcePacks() {
    await invoke("get_featured_resourcepacks", {
      branch: currentBranch,
      mcVersion: launchManifest.build.mcVersion,
    }).then((result) => {
      console.debug("Featured ResourcePacks", result);
      result.forEach(resourcePack => resourcePack.featured = true);
      featuredResourcePacks = result;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function searchResourcePacks() {
    let oldResourcePacks = resourcePacks;

    if (searchterm == "" && search_offset === 0) {
      if (featuredResourcePacks == null) {
        await getFeaturedResourcePacks();
      }
      oldResourcePacks = featuredResourcePacks;
    }
    
    // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
    // Update: Ich habe ne eigene Virtual List gemacht 📉
    updateResourcePacks([]);

    await invoke("search_resourcepacks", {
      params: {
        facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:resourcepack"]${Object.values(filters).filter(filter => filter.enabled).length > 0 ? ", " : ""}${Object.values(filters).filter(filter => filter.enabled).map(filter => `["categories:'${filter.id}'"]`).join(", ")}]`,
        index: search_index,
        limit: search_limit,
        offset: search_offset,
        query: searchterm,
      },
    }).then((result) => {
      console.debug("Search ResourcePack Result", result);

      loadMoreButton = result.hits.length === search_limit;

      if (!$noriskUser?.isDev) {
        console.debug("Filtering blacklisted ResourcePacks");
        const length = result.hits.length;
        result.hits = result.hits.filter(resourcePack => !blacklistedResourcePacks.includes(resourcePack.slug));
        console.debug(`Removed ${length - result.hits.length} blacklisted ResourcePacks`);
      }
      result.hits.forEach(resourcePack => {
        resourcePack.featured = featuredResourcePacks.find(featuredResourcePack => featuredResourcePack.slug === resourcePack.slug);
        resourcePack.blacklisted = blacklistedResourcePacks.includes(resourcePack.slug);
      });
      if (result.hits.length === 0) {
        updateResourcePacks(null);
      } else if ((search_offset == 0 && searchterm != "") || Object.values(filters).length > 0) {
        updateResourcePacks(result.hits);
      } else {
        updateResourcePacks([...oldResourcePacks, ...result.hits.filter(resourcePack => searchterm != "" || !featuredResourcePacks.some((element) => element.slug === resourcePack.slug))]);
      }
    }).catch((error) => {
      addNotification(error);
    });
  }

  function loadMore() {
    search_offset += search_limit;
    searchResourcePacks();
  }

  async function deleteInstalledResourcePack(resourcePack) {
    let index = launcherProfiles.addons[currentBranch].resourcePacks.findIndex((element) => {
      return element.slug.toUpperCase() === (resourcePack?.slug ?? resourcePack).toUpperCase();
    });

    if (index !== -1) {
      launcherProfiles.addons[currentBranch].resourcePacks.splice(index, 1);
      updateResourcePacks(resourcePacks);

      await invoke("get_resourcepack", {
        slug: resourcePack.slug,
        params: `?game_versions=["${launchManifest.build.mcVersion}"]`,
      }).then(async resourcePackVersion => {
        deleteResourcePackFile(resourcePackVersion.file_name);
        
        launcherProfiles.store();
        const prev = [resourcePacks, launcherProfiles.addons[currentBranch].resourcePacks]
        updateResourcePacks([]);
        updateProfileResourcePacks([]);
        await tick();
        updateResourcePacks(prev[0]);
        updateProfileResourcePacks(prev[1]);
      }).catch((error) => {
        addNotification(error);
      });
    } else {
      deleteResourcePackFile(resourcePack);
    }
  }

  async function deleteResourcePackFile(filename) {
    await invoke("delete_resourcepack_file", {
      fileName: filename,
      options: options,
      branch: launchManifest.build.branch,
    }).then(async () => {
      getCustomResourcePacksFilenames();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function createFileWatcher() {
    await invoke("get_custom_resourcepacks_folder", {
      options: options,
      branch: launchManifest.build.branch,
    }).then(async (folder) => {
      console.debug("File Watcher Folder", folder);
      fileWatcher = await watch(
        folder,
        getCustomResourcePacksFilenames,
        { recursive: true },
      );
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function handleSelectCustomResourcePacks() {
    try {
      const locations = await open({
        defaultPath: "/",
        multiple: true,
        filters: [{ name: lang.addons.mods.selectCustomResourcePackFileExtentionFilterName, extensions: ["zip"] }],
      });
      if (locations instanceof Array) {
        installCustomResourcePacks(locations);
      }
    } catch (error) {
      addNotification(lang.addons.mods.notification.failedToSelectCustomResourcePacks.replace("{error}", error));
    }
  }

  async function installCustomResourcePacks(locations) {
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
      noriskLog(`Installing custom ResourcePack ${fileName}`);
      await invoke("save_custom_resourcepack_to_folder", {
        options: options,
        branch: launchManifest.build.branch,
        file: { name: fileName, location: location },
      }).catch((error) => {
        addNotification(error);
      });
      getCustomResourcePacksFilenames();
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
    await getBlacklistedResourcePacks();
    await searchResourcePacks();
  }

  onMount(() => {
    [
      {
        type: lang.addons.resourcePacks.filters.categories.title,
        entries: [
          { id: "combat", name: lang.addons.resourcePacks.filters.categories.combat },
          { id: "cursed", name: lang.addons.resourcePacks.filters.categories.cursed },
          { id: "decoration", name: lang.addons.resourcePacks.filters.categories.decoration },
          { id: "modded", name: lang.addons.resourcePacks.filters.categories.modded },
          { id: "realistic", name: lang.addons.resourcePacks.filters.categories.realistic },
          { id: "simplistic", name: lang.addons.resourcePacks.filters.categories.simplistic },
          { id: "themed", name: lang.addons.resourcePacks.filters.categories.themed },
          { id: "tweaks", name: lang.addons.resourcePacks.filters.categories.tweaks },
          { id: "utility", name: lang.addons.resourcePacks.filters.categories.utility },
          { id: "vanilla-like", name: lang.addons.resourcePacks.filters.categories.vanillaLike },
        ],
      },
      {
        type: lang.addons.resourcePacks.filters.features.title,
        entries: [
          { id: "audio", name: lang.addons.resourcePacks.filters.features.audio },
          { id: "blocks", name: lang.addons.resourcePacks.filters.features.blocks },
          { id: "core-shaders", name: lang.addons.resourcePacks.filters.features.coreShaders },
          { id: "entities", name: lang.addons.resourcePacks.filters.features.entities },
          { id: "environment", name: lang.addons.resourcePacks.filters.features.environment },
          { id: "equipment", name: lang.addons.resourcePacks.filters.features.equipment },
          { id: "fonts", name: lang.addons.resourcePacks.filters.features.fonts },
          { id: "gui", name: lang.addons.resourcePacks.filters.features.gui },
          { id: "items", name: lang.addons.resourcePacks.filters.features.items },
          { id: "locale", name: lang.addons.resourcePacks.filters.features.locale },
          { id: "models", name: lang.addons.resourcePacks.filters.features.models },
        ],
      },
      {
        type: lang.addons.resourcePacks.filters.performance.title,
        entries: [
          { id: "8x-", name: lang.addons.resourcePacks.filters.performance.x8orLower},
          { id: "16x", name: lang.addons.resourcePacks.filters.performance.x16 },
          { id: "32x", name: lang.addons.resourcePacks.filters.performance.x32 },
          { id: "48x", name: lang.addons.resourcePacks.filters.performance.x48 },
          { id: "64x", name: lang.addons.resourcePacks.filters.performance.x64 },
          { id: "128x", name: lang.addons.resourcePacks.filters.performance.x128 },
          { id: "256x", name: lang.addons.resourcePacks.filters.performance.x256 },
          { id: "512x+", name: lang.addons.resourcePacks.filters.performance.x512orHigher},
        ],
      },
    ]
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
    <h1 on:click={handleSelectCustomResourcePacks}>{lang.addons.global.navbar.button.custom}</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            listScroll = 0;
            searchResourcePacks();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder={lang.addons.resourcePacks.searchbar.modrinth.placeholder} />
    {#if resourcePacks !== null && resourcePacks.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...resourcePacks, loadMoreButton ? 'LOAD_MORE_RESOURCEPACKS' : null] as item}
          {#if item == 'LOAD_MORE_RESOURCEPACKS'}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="load-more-button" on:click={loadMore}><p class="primary-text">LOAD MORE</p></div>
          {:else if item != null}
            <ResourcePackItem text={checkIfRequiredOrInstalled(item.slug)}
              on:delete={() => deleteInstalledResourcePack(item)}
              on:install={() => installResourcePack(item)}
              type="RESULT"
              resourcePack={item}
            />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{resourcePacks == null ? lang.addons.resourcePacks.noResourcePacksFound : lang.addons.global.loading}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={async () => {
      const prev = launcherProfiles.addons[currentBranch].resourcePacks;
      launcherProfiles.addons[currentBranch].resourcePacks = [];
      await tick();
      launcherProfiles.addons[currentBranch].resourcePacks = prev;
    }} bind:searchTerm={filterterm}
                       placeHolder={lang.addons.resourcePacks.searchbar.installed.placeholder} />
    {#if launcherProfiles.addons[currentBranch].resourcePacks.length > 0 || customResourcePacks.length > 0}
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...customResourcePacks,...launcherProfiles.addons[currentBranch].resourcePacks].filter((resourcePack) => {
          let name = (resourcePack?.title ?? resourcePack).toUpperCase()
          return (resourcePack?.title != null || name.endsWith(".ZIP")) && name.includes(filterterm.toUpperCase())
      }).sort((a, b) => (a?.title ?? a).localeCompare(b?.title ?? b)) as item}
          {#if (typeof item === 'string' || item instanceof String)}
            <ResourcePackItem text="INSTALLED"
              on:delete={() => deleteInstalledResourcePack(item)}
              type="CUSTOM"
              resourcePack={item}
            />
          {:else}
            <ResourcePackItem text="INSTALLED"
              on:delete={() => deleteInstalledResourcePack(item)}
              type="INSTALLED"
              resourcePack={item}
            />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{launcherProfiles.addons[currentBranch].resourcePacks.length < 1 ? lang.addons.resourcePacks.noResourcePacksInstalled : lang.addons.global.loading}</h1>
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
