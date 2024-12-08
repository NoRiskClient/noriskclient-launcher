<script>
  import { invoke } from "@tauri-apps/api";
  import { removeFile } from "@tauri-apps/api/fs";
  import { open } from "@tauri-apps/api/dialog";
  import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
  import ShaderItem from "./ShaderItem.svelte";
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
  let customShaders = [];
  let featuredShaders = null;
  let blacklistedShaders = [];
  let shaders = [];
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
    if (currentTabIndex !== 1) {
      return;
    }

    const time = Date.now();
    if (time - lastFileDrop < 1000) return;
    lastFileDrop = time;
    let todo = new Set();
    files.payload.forEach(l => todo.add(l));
    installCustomShaders(todo);
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

  async function updateShaders(newShaders) {
    shaders = newShaders;

    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }
  async function updateProfileShaders(newShaders) {
    launcherProfiles.addons[currentBranch].shaders = newShaders;

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
      getCustomShadersFilenames();
      createFileWatcher();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function getBlacklistedShaders() {
    await invoke("get_blacklisted_shaders").then((result) => {
      console.debug("Blacklisted Shaders", result);
      blacklistedShaders = result;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function getCustomShadersFilenames() {
    await invoke("get_custom_shaders_filenames", {
      options: options,
      branch: launchManifest.build.branch,
      installedShaders: launcherProfiles.addons[currentBranch].shaders,
    }).then((fileNames) => {
      fileNames = fileNames.filter(f => f != "subwaysurfers_shader.zip");

      console.debug("Custom Shaders", fileNames);
      customShaders = fileNames;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function installShader(shader) {
    shader.loading = true;
    updateShaders(shaders);

    await invoke("get_shader", {
      slug: shader.slug,
      params: `?game_versions=["${launchManifest.build.mc_version}"]&loaders=["iris"]`,
    }).then(async (result) => {
      launcherProfiles.addons[currentBranch].shaders.pushIfNotExist(result, function(e) {
        return e.slug === result.slug;
      });
      updateShaders(shaders);
      updateProfileShaders(launcherProfiles.addons[currentBranch].shaders);
      launcherProfiles.store();

      await invoke("download_shader", {
        options: $launcherOptions,
        branch: launchManifest.build.branch,
        shader: result,
      }).then(() => {
        shader.loading = false;
        updateShaders(shaders);
      }).catch((error) => {
        addNotification(error);
      });
    }).catch((error) => {
      addNotification(error);
    });
  }

  function checkIfRequiredOrInstalled(slug) {
    if (launcherProfiles.addons[currentBranch].shaders.some((shader) => {
      return shader.slug.toUpperCase() === slug.toUpperCase();
    })) {
      return "INSTALLED";
    }
    return "INSTALL";
  }

  async function getFeaturedShaders() {
    await invoke("get_featured_shaders", {
        branch: currentBranch,
        mcVersion: launchManifest.build.mc_version,
      }).then((result) => {
        console.debug("Featured Shaders", result);
        result.forEach(shader => shader.featured = true);
        featuredShaders = result;
      }).catch((error) => {
        addNotification(error);
        featuredShaders = [];
      });
  }

  async function searchShaders() {
    let oldShaders = shaders;

    if (searchterm == "" && search_offset === 0) {
      if (featuredShaders == null) {
        await getFeaturedShaders();
      }
      oldShaders = featuredShaders;
    }

    // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
    // Update: Ich habe ne eigene Virtual List gemacht 📉
    updateShaders([]);

    await invoke("search_shaders", {
      params: {
        facets: `[["versions:${launchManifest.build.mc_version}"], ["project_type:shader"], ["categories:'iris'"]${Object.values(filters).filter(filter => filter.enabled).length > 0 ? ", " : ""}${Object.values(filters).filter(filter => filter.enabled).map(filter => `["categories:'${filter.id}'"]`).join(", ")}]`,
        index: search_index,
        limit: search_limit,
        offset: search_offset,
        query: searchterm,
      },
    }).then((result) => {
      console.debug("Search Shader Result", result);

      loadMoreButton = result.hits.length === search_limit;

      if (!$noriskUser?.isDev) {
        console.debug("Filtering Blacklisted Shaders", blacklistedShaders);
        const length = result.hits.length;
        result.hits = result.hits.filter(shader => !blacklistedShaders.includes(shader.slug));
        console.debug(`Filtered ${length - result.hits.length} Blacklisted Shaders`);
      }
      result.hits.forEach(shader => {
        shader.featured = featuredShaders.find(featuredShader => featuredShader.slug === shader.slug);
        shader.blacklisted = blacklistedShaders.includes(shader.slug);
      });
      if (result.hits.length === 0) {
        updateShaders(null);
      } else if ((search_offset === 0 && searchterm !== "") || (Object.values(filters).length > 0 && search_offset == 0)) {
        updateShaders(result.hits);
      } else {
        updateShaders([...oldShaders, ...result.hits.filter(shader => searchterm !== "" || !featuredShaders.some((element) => element.slug === shader.slug))]);
      }
    }).catch((error) => {
      addNotification(error);
    });
  }

  function loadMore() {
    search_offset += search_limit;
    searchShaders();
  }

  async function deleteInstalledShader(shader) {
    let index = launcherProfiles.addons[currentBranch].shaders.findIndex((element) => {
      return element.slug.toUpperCase() === (shader?.slug ?? shader).toUpperCase();
    });
    if (index !== -1) {
      launcherProfiles.addons[currentBranch].shaders.splice(index, 1);
      updateShaders(shaders);

      await invoke("get_shader", {
        slug: shader.slug,
        params: `?game_versions=["${launchManifest.build.mc_version}"]&loaders=["iris"]`,
      }).then(async shaderVersion => {
        deleteShaderFile(shaderVersion.file_name);

        launcherProfiles.store();
        const prev = [shaders, launcherProfiles.addons[currentBranch].shaders];
        updateShaders([]);
        updateProfileShaders([]);
        await tick();
        updateShaders(prev[0]);
        updateProfileShaders(prev[1]);
      }).catch((error) => {
        addNotification(error);
      });
    } else {
      deleteShaderFile(shader);
    }
  }

  async function deleteShaderFile(filename) {
    await invoke("delete_shader_file", {
      fileName: filename,
      options: options,
      branch: launchManifest.build.branch,
    }).then(async () => {
      getCustomShadersFilenames();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function createFileWatcher() {
    await invoke("get_custom_shaders_folder", {
      options: options,
      branch: launchManifest.build.branch,
    }).then(async (folder) => {
      console.debug("File Watcher Folder", folder);
      // can also watch an array of paths
      fileWatcher = await watch(
        folder,
        getCustomShadersFilenames,
        { recursive: true },
      );
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function handleSelectCustomShaders() {
    try {
      const locations = await open({
        defaultPath: "/",
        multiple: true,
        filters: [{ name: "Shaders", extensions: ["zip"] }],
      });
      if (locations instanceof Array) {
        installCustomShaders(locations);
      }
    } catch (error) {
      addNotification(lang.addons.shaders.notification.failedToSelectCustomShaders.replace("{error}", error));
    }
  }

  async function installCustomShaders(locations) {
    for (const location of locations) {
      if (!location.endsWith(".zip")) {
        continue;
      }
      let splitter = "";
      if (location.split("/")[0] === "") {
        splitter = "/";
      } else {
        splitter = "\\";
      }
      const fileName = location.split(splitter)[location.split(splitter).length - 1];
      noriskLog(`Installing custom Shader ${fileName}`);
      await invoke("save_custom_shader_to_folder", {
        options: options,
        branch: launchManifest.build.branch,
        file: { name: fileName, location: location },
      }).catch((error) => {
        addNotification(error);
      });
      getCustomShadersFilenames();
    }
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
    await getBlacklistedShaders();
    searchShaders();
  }

  onMount(() => {
    filterCategories = [
      {
        type: lang.addons.shaders.filter.categories.title,
        entries: [
          { id: "cartoon", name: lang.addons.shaders.filter.categories.cartoon },
          { id: "cursed", name: lang.addons.shaders.filter.categories.cursed },
          { id: "fantasy", name: lang.addons.shaders.filter.categories.fantasy },
          { id: "realistic", name: lang.addons.shaders.filter.categories.realistic },
          { id: "semi-realistic", name: lang.addons.shaders.filter.categories.semiRealistic },
          { id: "vanilla-like", name: lang.addons.shaders.filter.categories.vanillaLike },
        ],
      },
      {
        type: lang.addons.shaders.filter.features.title,
        entries: [
          { id: "atmosphere", name: lang.addons.shaders.filter.features.atmosohere },
          { id: "bloom", name: lang.addons.shaders.filter.features.bloom },
          { id: "colored-lighting", name: lang.addons.shaders.filter.features.coloredLighting },
          { id: "foliage", name: lang.addons.shaders.filter.features.foliage },
          { id: "path-tracing", name: lang.addons.shaders.filter.features.pathTracing },
          { id: "pbr", name: lang.addons.shaders.filter.features.pbr },
          { id: "reflections", name: lang.addons.shaders.filter.features.reflections },
          { id: "shadows", name: lang.addons.shaders.filter.features.shadows },
        ],
      },
      {
        type: lang.addons.shaders.filter.performanceImpact.title,
        entries: [
          { id: "potato", name: lang.addons.shaders.filter.performanceImpact.potato },
          { id: "low", name: lang.addons.shaders.filter.performanceImpact.low },
          { id: "medium", name: lang.addons.shaders.filter.performanceImpact.medium },
          { id: "high", name: lang.addons.shaders.filter.performanceImpact.high },
          { id: "screenshot", name: lang.addons.shaders.filter.performanceImpact.screenshot },
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
    <h1 on:click={handleSelectCustomShaders}>{lang.addons.global.navbar.button.custom}</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            listScroll = 0;
            searchShaders();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder={lang.addons.shaders.searchbar.modrinth.placeholder} />
    {#if shaders !== null && shaders.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...shaders, loadMoreButton ? 'LOAD_MORE_SHADERS' : null] as item}
          {#if item == 'LOAD_MORE_SHADERS'}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="load-more-button" on:click={loadMore}><p class="primary-text">{lang.addons.global.button.loadMore}</p></div>
          {:else if item != null}
            <ShaderItem text={checkIfRequiredOrInstalled(item.slug)}
              on:delete={() => deleteInstalledShader(item)}
              on:install={() => installShader(item)}
              type="RESULT"
              shader={item}
            />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{shaders == null ? lang.addons.shaders.noShadersFound : lang.addons.global.loading}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={async () => {
      const prev = launcherProfiles.addons[currentBranch].resourcePacks;
      launcherProfiles.addons[currentBranch].resourcePacks = [];
      await tick();
      launcherProfiles.addons[currentBranch].resourcePacks = prev;
    }} bind:searchTerm={filterterm} placeHolder={lang.addons.shaders.searchbar.installed.placeholder} />
    {#if launcherProfiles.addons[currentBranch].shaders.length > 0 || customShaders.length > 0}
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...customShaders,...launcherProfiles.addons[currentBranch].shaders].filter((shader) => {
          let name = (shader?.title ?? shader).toUpperCase()
          return (shader?.title != null || name.endsWith(".ZIP")) && name.includes(filterterm.toUpperCase())
      }).sort((a, b) => (a?.title ?? a).localeCompare(b?.title ?? b)) as item}
          {#if (typeof item === 'string' || item instanceof String)}
            <ShaderItem text="INSTALLED"
              on:delete={() => deleteInstalledShader(item)}
              type="CUSTOM"
              shader={item}
            />
          {:else}
            <ShaderItem text="INSTALLED"
              on:delete={() => deleteInstalledShader(item)}
              type="INSTALLED"
              shader={item}
            />
          {/if}
        {/each}
      </div>
      {:else}
      <h1 class="loading-indicator">{launcherProfiles.addons[currentBranch].shaders.length < 1 ? lang.addons.shaders.noShadersInstalled : lang.addons.global.loading}</h1>
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
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .loading-indicator {
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 20px;
        margin-top: 200px;
    }

    .load-more-button {
        display: flex;
        flex-direction: row;
        justify-content: center;
        margin-top: 20px;
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: pointer;
        transition-duration: 150ms;
    }

    .load-more-button:hover {
        transform: scale(1.2);
    }

    .modrinth-wrapper {
        width: 100%;
        height: 100%;
        padding: 1em;
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
