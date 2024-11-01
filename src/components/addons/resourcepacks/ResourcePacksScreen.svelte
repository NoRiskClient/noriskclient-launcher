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
  let fileWatcher;
  let listScroll = 0;

  let search_offset = 0;
  let search_limit = 30;
  let search_index = "relevance";

  let filterCategories = [
    {
      type: "Categories",
      entries: [
        { id: "combat", name: "Combat" },
        { id: "cursed", name: "Cursed" },
        { id: "decoration", name: "Decoration" },
        { id: "modded", name: "Modded" },
        { id: "realistic", name: "Realistic" },
        { id: "simplistic", name: "Simplistic" },
        { id: "themed", name: "Themed" },
        { id: "tweaks", name: "Tweaks" },
        { id: "utility", name: "Utility" },
        { id: "vanilla-like", name: "Vanilla Like" },
      ],
    },
    {
      type: "Features",
      entries: [
        { id: "audio", name: "Audio" },
        { id: "blocks", name: "Blocks" },
        { id: "core-shaders", name: "Core Shaders" },
        { id: "entities", name: "Entities" },
        { id: "environment", name: "Environment" },
        { id: "equipment", name: "Equipment" },
        { id: "fonts", name: "Fonts" },
        { id: "gui", name: "GUI" },
        { id: "items", name: "Items" },
        { id: "locale", name: "Locale" },
        { id: "models", name: "Models" },
      ],
    },
    {
      type: "Performance",
      entries: [
        { id: "8x-", name: "8x or lower" },
        { id: "16x", name: "16x" },
        { id: "32x", name: "32x" },
        { id: "48x", name: "48x" },
        { id: "64x", name: "64x" },
        { id: "128x", name: "128x" },
        { id: "256x", name: "256x" },
        { id: "512x+", name: "512x or higher" },
      ],
    },
  ];
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
    await invoke("install_resourcepack", {
      slug: resourcePack.slug,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]`,
    }).then((result) => {
      launcherProfiles.addons[currentBranch].resourcePacks.pushIfNotExist(result, function(e) {
        return e.slug === result.slug;
      });
      resourcePack.loading = false;
      updateResourcePacks(resourcePacks);
      updateProfileResourcePacks(launcherProfiles.addons[currentBranch].resourcePacks);
      launcherProfiles.store();
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
    if (searchterm == "" && search_offset === 0) {
      if (featuredResourcePacks == null) {
        await getFeaturedResourcePacks();
      }
      updateResourcePacks([]);
      // Wait for the UI to update
      await tick();
      updateResourcePacks(featuredResourcePacks);
    } else {
      // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
      // Update: Ich habe ne eigene Virtual List gemacht 📉
      updateResourcePacks([]);
    }

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
        updateResourcePacks([...resourcePacks, ...result.hits.filter(resourcePack => searchterm != "" || !featuredResourcePacks.some((element) => element.slug === resourcePack.slug))]);
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
      deleteResourcePackFile(resourcePack?.file_name ?? resourcePack);
      launcherProfiles.store();

      const prev = [resourcePacks, launcherProfiles.addons[currentBranch].resourcePacks]
      updateResourcePacks([]);
      updateProfileResourcePacks([]);
      await tick();
      updateResourcePacks(prev[0]);
      updateProfileResourcePacks(prev[1]);
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
        filters: [{ name: "Resource Packs", extensions: ["zip"] }],
      });
      if (locations instanceof Array) {
        installCustomResourcePacks(locations);
      }
    } catch (error) {
      addNotification("Failed to select file using dialog: " + error);
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
      await invoke("save_custom_resourcepacks_to_folder", {
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
    load();
  });

  onDestroy(() => {
    fileWatcher = null;
  });
</script>

<div class="modrinth-wrapper">
  <div class="navbar">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>Discover</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>Installed</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleSelectCustomResourcePacks}>Custom</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            searchResourcePacks();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder="Search for Resource Packs on Modrinth..." />
    {#if resourcePacks !== null && resourcePacks.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...resourcePacks, resourcePacks.length >= 30 ? 'LOAD_MORE_RESOURCEPACKS' : null] as item}
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
      <h1 class="loading-indicator">{resourcePacks == null ? 'No Resource Packs found.' : 'Loading...'}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm}
                       placeHolder="Filter installed Resource Packs..." />
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
      <h1 class="loading-indicator">{launcherProfiles.addons[currentBranch].resourcePacks.length < 1 ? 'No resourcepacks installed.' : 'Loading...'}</h1>
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
