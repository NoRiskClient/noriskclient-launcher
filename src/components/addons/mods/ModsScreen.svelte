<script>
  import { invoke } from "@tauri-apps/api";
  import { open } from "@tauri-apps/api/dialog";
  import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
  import ModItem from "./ModItem.svelte";
  import { tick, onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";
  import { launcherOptions } from "../../../stores/optionsStore.js";
  import { profiles } from "../../../stores/profilesStore.js";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { addNotification } from "../../../stores/notificationStore.js";
  import { getNoRiskToken, noriskUser, noriskLog } from "../../../utils/noriskUtils.js";

  export let isServersideInstallation = false;

  $: currentBranch = $branches[$currentBranchIndex];
  $: options = $launcherOptions;
  $: launcherProfiles = $profiles;
  let launcherProfile = null;
  let customModFiles = [];
  let baseMods = null;
  let mods = [];
  let featuredMods = [];
  let blacklistedMods = [];
  let modVersions = {};
  let launchManifest = null;
  let searchterm = "";
  let filterterm = "";
  let currentTabIndex = 0;
  let listScroll = 0;

  let search_offset = 0;
  let search_limit = 30;
  let search_index = "relevance";

  let filterCategories = [
    {
      type: "Environments",
      entries: [
        { id: "client_side", name: "Client" },
        { id: "server_side", name: "Server" },
      ],
    },
    {
      type: "Categories",
      entries: [
        { id: "adventure", name: "Adventure" },
        { id: "cursed", name: "Cursed" },
        { id: "decoration", name: "Decoration" },
        { id: "economy", name: "Economy" },
        { id: "equipment", name: "Equipment" },
        { id: "food", name: "Food" },
        { id: "game-mechanics", name: "Game Mechanics" },
        { id: "library", name: "Library" },
        { id: "magic", name: "Magic" },
        { id: "management", name: "Management" },
        { id: "minigame", name: "Minigame" },
        { id: "mobs", name: "Mobs" },
        { id: "optimization", name: "Optimization" },
        { id: "social", name: "Social" },
        { id: "storage", name: "Storage" },
        { id: "technology", name: "Technology" },
        { id: "transportation", name: "Transportation" },
        { id: "utility", name: "Utility" },
        { id: "worldgen", name: "Worldgen" },
      ],
    },
  ];
  let filters = {};

  if (!isServersideInstallation) {
    filterCategories.shift();
  }

  $: loginData = $defaultUser;

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
    
    installCustomMods(todo);
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

  async function updateMods(newMods) {
    mods = newMods;
    
    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }

  async function updateProfileMods(newMods) {
    launcherProfile.mods = newMods;
    
    // Try to scroll to the previous position
    try {
      await tick();
      document.getElementById('scrollList').scrollTop = listScroll ?? 0;
    } catch(_) {}
  }

  function scrollToBottom() {
    // Try to scroll to the bottom
    try {
      document.getElementById('scrollList').scrollTop = document.getElementById('scrollList').scrollHeight;
    } catch (_) {}
  }

  async function getLaunchManifest() {
    await invoke("get_launch_manifest", {
      branch: currentBranch,
      noriskToken: getNoRiskToken(),
      uuid: loginData.id,
    }).then((result) => {
      console.debug("Launch Manifest", result);
      launchManifest = result;
    }).catch((error) => {
      addNotification("Failed to get launch manifest: " + error);
    });
  }

  async function getBlacklistedMods() {
    await invoke("get_blacklisted_mods").then((mods) => {
      console.debug("Blacklisted Mods", mods);
      blacklistedMods = mods;
    }).catch((error) => {
      console.error(error);
    });
  }

  async function getCustomModsFilenames() {
    await invoke("get_custom_mods_filenames", {
      options: options,
      profileName: launcherProfile.name
    }).then((fileNames) => {
      console.debug("Custom Mods", fileNames);
      customModFiles = fileNames;
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function getModVersions(slug) {
    if (modVersions[slug]) {
      return modVersions[slug];
    }

    await invoke("get_project_version", {
      slug: slug,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["fabric"]`,
    }).then(async (result) => {
      modVersions[slug] = result.map(v => v.version_number);
      console.debug(`Project Versions of ${slug}`, modVersions[slug]);
    }).catch((error) => {
      addNotification(error);
      modVersions[slug] = [];
    });

    return modVersions[slug];
  }

  async function installModAndDependencies(mod) {
    mod.loading = true;
    updateMods(mods);
    await invoke("install_mod_and_dependencies", {
      slug: mod.slug,
      version: null,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["fabric"]`,
      requiredMods: launchManifest.mods,
    }).then((result) => {
      const blockedDependencies = result.dependencies.filter(d => blacklistedMods.some(slug => slug == d.value.source.artifact.split(":")[1]))
      if (blockedDependencies.length > 0) {
        addNotification(`Failed to install mod because of incompatible dependencies:<br><br>${blockedDependencies.map(d => d.value.name).join(', ')}`, "ERROR", null, 5000);
        return;
      }

      result.image_url = mod.icon_url;
      launcherProfile.mods.pushIfNotExist(result, function(e) {
        return e.value.name === result.value.name;
      });
      mod.loading = false;
      updateMods(mods);
      updateProfileMods(launcherProfile.mods);
      launcherProfiles.store();
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function changeModVersion(slug, version) {
    let mod = launcherProfile.mods.find(mod => mod.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase());
    if (!mod) {
      addNotification(`Failed to change version of ${slug} because it is not installed.`);
      return;
    }

    await invoke("install_mod_and_dependencies", {
      slug: slug,
      version: version,
      params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["fabric"]`,
      requiredMods: launchManifest.mods,
    }).then(async (result) => {
      const blockedDependencies = result.dependencies.filter(d => blacklistedMods.some(slug => slug == d.value.source.artifact.split(":")[1]))
      if (blockedDependencies.length > 0) {
        addNotification(`Failed to install mod because of incompatible dependencies:<br><br>${blockedDependencies.map(d => d.value.name).join(', ')}`, "ERROR", null, 5000);
        return;
      }

      const original = mod;
      // Replace with new version info 
      mod.value = result.value;
      mod.dependencies = result.dependencies;
      launcherProfile.mods.splice(launcherProfile.mods.indexOf(original), 1, mod);
     
      const before = launcherProfile.mods;
      updateProfileMods([]);
      await tick();
      updateProfileMods(before);
      launcherProfiles.store();
    }).catch((error) => {
      addNotification(error);
    });
  }

  function checkIfRequiredOrInstalled(item) {
    const slug = item.slug;

    if (launchManifest.mods.some((mod) => {
      return mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase();
    })) {
      if (launchManifest.mods.find((mod) =>
        mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase(),
      ).required) {
        return "REQUIRED";
      } else {
        return "RECOMENDED";
      }
    }
    
    if (!launcherProfile.mods.some((mod) => {
      return mod.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase();
    }) && launcherProfile.mods.some((mod) => mod.dependencies.some((dependency) => dependency.value.source.artifact.split(':')[1].toUpperCase() == slug.toUpperCase()))) {
      return "DEPENDENCY";
    }

    if (launcherProfile.mods.some((mod) => {
      return mod.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase();
    })) {
      return "INSTALLED";
    }
    return "INSTALL";
  }

  async function getBaseMods() {
    await invoke("get_featured_mods", {
      branch: currentBranch,
      mcVersion: launchManifest.build.mcVersion,
    }).then((result) => {
      console.debug("Featured Mods", result);
      result.forEach(mod => mod.featured = true);
      baseMods = result;
      featuredMods = result;
      launchManifest.mods.forEach(async mod => {
        if (!mod.required) {
          const slug = mod.source.artifact.split(":")[1];
          let author;
          let iconUrl = "src/images/norisk_logo.png";
          let description = "A custom NoRiskClient Mod.";
          if (mod.source.repository !== "norisk" && mod.source.repository !== "CUSTOM") {
            await invoke("get_mod_info", { slug }).then(info => {
              author = info.author ?? null;
              iconUrl = info.icon_url;
              description = info.description;
            }).catch((error) => {
              addNotification(error);
            });
          }
          if (!mod.enabled) disableRecomendedMod(slug);
          baseMods.push({
            author: author,
            description: description,
            icon_url: iconUrl,
            slug: slug,
            title: mod.name,
          });
        }
      });
      console.log("Base Mods", baseMods);
      
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function searchMods() {
    if (searchterm == "" && search_offset === 0) {
      if (baseMods == null) {
        await getBaseMods();
      }
      updateMods([]);
      // Wait for the UI to update
      await tick();
      updateMods(baseMods);
    } else {
      // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
      // Update: Ich habe ne eigene Virtual List gemacht 📉
      updateMods([]);
    }

    let client_server_side_filters = "";
    const client_side = Object.values(filters).find(filter => filter.id === "client_side");
    const server_side = Object.values(filters).find(filter => filter.id === "server_side");
    if (!client_side && !server_side) {
      client_server_side_filters = "";
    } else if (client_side.enabled && server_side.enabled) {
      client_server_side_filters = ", [\"client_side:required\"], [\"server_side:required\"]";
    } else if (client_side.enabled && !server_side.enabled) {
      client_server_side_filters = ", [\"client_side:optional\",\"client_side:required\"], [\"server_side:optional\",\"server_side:unsupported\"]";
    } else if (!client_side.enabled && server_side.enabled) {
      client_server_side_filters = ", [\"client_side:optional\",\"client_side:unsupported\"], [\"server_side:optional\",\"server_side:required\"]";
    }

    const notEnvironmentFilter = (filter) => filter.id !== "client_side" && filter.id !== "server_side";

    await invoke("search_mods", {
      params: {
        facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:mod"], ["categories:fabric"]${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).length > 0 ? ", " : ""}${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).map(filter => `["categories:'${filter.id}'"]`).join(", ")}${client_server_side_filters}]`,
        index: search_index,
        limit: search_limit + (searchterm === "" ? launchManifest.mods.length : 0),
        offset: search_offset,
        query: searchterm,
      },
    }).then((result) => {
      console.debug("Search Mod Result", result);
      
      if (!$noriskUser?.isDev) {
        console.debug("Filtering blacklisted mods...");
        const length = result.hits.length;
        result.hits = result.hits.filter(mod => !blacklistedMods.includes(mod.slug));
        console.debug(`Filtered ${length - result.hits.length} blacklisted mods.`);
      }
      result.hits.forEach(mod => {
        mod.featured = featuredMods.find(featuredMod => featuredMod.slug === mod.slug);
        mod.blacklisted = blacklistedMods.includes(mod.slug);
      });
      if (result.hits.length === 0) {
        updateMods(null);
      } else if ((search_offset == 0 && searchterm != "") || Object.values(filters).length > 0) {
        updateMods(result.hits);;
      } else {
        updateMods([...mods, ...result.hits.filter(mod => searchterm != "" || (!launchManifest.mods.some((launchManifestMod) => {
          return launchManifestMod.source.artifact.split(":")[1].toUpperCase() === mod.slug.toUpperCase();
        }) && !featuredMods.some((featuredMod) => {
          return featuredMod.slug.toUpperCase() === mod.slug.toUpperCase();
        })))]);
      }
    }).catch((error) => {
      addNotification(error);
    });
  }

  function loadMore() {
    search_offset += search_limit + (searchterm === "" ? launchManifest.mods.length : 0);
    searchMods();
  }

  async function toggleInstalledMod(mod) {
    mod.value.enabled = !mod.value.enabled;
    updateProfileMods(launcherProfile.mods);
    launcherProfiles.store();
    const keep = launcherProfile.mods;
    updateProfileMods([]);
    setTimeout(() => {
      updateProfileMods(keep);
    }, 0);
  }

  async function deleteInstalledMod(slug, isCustom = false) {
    let index = launcherProfile.mods.findIndex((element) => {
      return element.value.source.artifact.split(":")[isCustom ? 2 : 1].toUpperCase() === slug.toUpperCase();
    });
    
    if (index !== -1) {
      launcherProfile.mods.splice(index, 1);
      launcherProfiles.store();

      // Fragt nicht, sonst squashen mod item names ineinander?????
      const prev = [mods, launcherProfile.mods];
      updateMods([]);
      updateProfileMods([]);
      await tick();
      updateMods(prev[0]);
      updateProfileMods(prev[1]);
    }
  }

  async function disableRecomendedMod(slug) {
    if (launcherProfile.mods.find(mod => mod.value.name.toUpperCase() === slug.toUpperCase())) {
      return;
    }
    launcherProfile.mods.push({
      title: slug,
      image_url: "",
      value: {
        required: false,
        enabled: false,
        name: slug,
        source: {
          type: "repository",
          repository: "",
          artifact: `PLACEHOLDER:${slug}`,
          url: "",
        },
      },
      dependencies: [],
    });
    updateMods(mods);
    updateProfileMods(launcherProfile.mods);
    launcherProfiles.store();
  }

  async function enableRecomendedMod(slug) {
    let index = launcherProfile.mods.findIndex((element) => {
      return element.value.name.toUpperCase() === slug.toUpperCase();
    });
    if (index !== -1) {
      launcherProfile.mods.splice(index, 1);
      updateMods(mods);
      updateProfileMods(launcherProfile.mods);
      launcherProfiles.store();
    }
  }

  async function deleteCustomModFile(fileName) {
    await invoke("delete_custom_mod_file", {
      options: options,
      profileName: launcherProfile.name,
      file: fileName,
    }).then(() => {
      customModFiles.splice(customModFiles.indexOf(fileName), 1);
      deleteInstalledMod(fileName, true);
    }).catch((error) => {
      addNotification(error);
    });
  }

  async function handleSelectCustomMods() {
    try {
      const locations = await open({
        defaultPath: "/",
        multiple: true,
        filters: [{ name: "Custom Mods", extensions: ["jar"] }],
      });
      if (locations instanceof Array) {
        installCustomMods(locations);
      }
    } catch (error) {
      addNotification("Failed to select file using dialog: " + error);
    }
  }

  async function installCustomMods(locations) {
    locations.forEach(async (location) => {
      let splitter = "";
      if (location.split("/")[0] == "") {
        splitter = "/";
      } else {
        splitter = "\\";
      }
      const fileName = location.split(splitter)[location.split(splitter).length - 1];

      if (!fileName.endsWith(".jar")) {
        addNotification(`Cannot install ${fileName}!<br><br>Only .jar files are supported.`);
        return;
      }

      if (customModFiles.includes(fileName)) {
        addNotification(`Cannot install ${fileName}!<br><br>Mod already exists.`);
        return;
      }

      noriskLog(`Installing custom Mod ${fileName}`);
      await invoke("save_custom_mods_to_folder", {
        options: options,
        profileName: launcherProfile.name,
        file: { name: fileName, location: location },
      }).then(() => {
        launcherProfile.mods.push({
          title: fileName,
          image_url: "",
          value: {
            required: false,
            enabled: true,
            name: fileName,
            source: {
              type: "repository",
              repository: "CUSTOM",
              artifact: `CUSTOM:${launcherProfile.name}:${fileName}`,
              url: "",
            },
          },
          dependencies: [],
        });
        updateMods(mods);
        updateProfileMods(launcherProfile.mods);
        customModFiles.push(fileName);
        launcherProfiles.store();
      }).catch((error) => {
        if (error.includes("os error 32")) return;
        addNotification(error);
      });
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
    await getBlacklistedMods();
    await getCustomModsFilenames();
    await searchMods();
  }

  onMount(() => {
    load();
  });
</script>

<div class="modrinth-wrapper">
  <div class="navbar">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 0} on:click={() => {currentTabIndex = 0, listScroll = 0}}>Discover</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 1} on:click={() => {currentTabIndex = 1, listScroll = 0}}>Installed</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleSelectCustomMods}>Custom</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            searchMods();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder="Search for Mods on Modrinth..." />
    {#if mods !== null && mods.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...mods, mods.length >= 30 ? 'LOAD_MORE_MODS' : null] as item}
          {#if item === 'LOAD_MORE_MODS'}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="load-more-button" on:click={loadMore}><p class="primary-text">LOAD MORE</p></div>
          {:else if item != null}
            <ModItem
              text={checkIfRequiredOrInstalled(item)}
              enabled={launcherProfile.mods.find(mod => mod.value.name === item.slug)?.value?.enabled ?? true}
              on:install={() => installModAndDependencies(item)}
              on:enable={() => enableRecomendedMod(item.slug)}
              on:disable={() => disableRecomendedMod(item.slug)}
              on:delete={() => deleteInstalledMod(item.slug)}
              type="RESULT"
              modVersions={null}
              mod={item} />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{mods == null ? 'No Mods found.' : 'Loading...'}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm} placeHolder="Filter installed Mods..." />
    {#if launcherProfile.mods.length > 0}
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop}>
        {#each (() => {
          let dependencies = new Set();
          launcherProfile.mods
            .map(m => m.dependencies)
            .flat()
            .forEach(d => {
              let slug = d.value.source.artifact.split(":")[1];
              if (!Array.from(dependencies).some(d_ => d_.value.source.artifact.split(":")[1] == slug) && !launcherProfile.mods.some(m => m.value.source.artifact.split(":")[1] == slug)) {
                d.parents = launcherProfile.mods.filter(m => m.dependencies.some(dependency => dependency.value.source.artifact.split(":")[1] == slug)).map(m => m.title);
                dependencies.add(d);
              }
            });
  
          return [...launcherProfile.mods, ...dependencies].filter((mod) => {
            let name = mod.value.name.toUpperCase()
            return name.includes(filterterm.toUpperCase()) && !mod.value.source.artifact.includes("PLACEHOLDER")
          }).map(mod => {
            mod.isMissing = mod.value.source.repository == 'CUSTOM' && !customModFiles.includes(mod.value.source.artifact.split(':')[2]);
            return mod
          }).sort((a, b) => a.title.localeCompare(b.title))
        })() as item}
          {#if item.value.source.repository == 'CUSTOM'}
            <ModItem
              text="INSTALLED"
              enabled={item.value.enabled}
              on:delete={() => deleteCustomModFile(item.value.source.artifact.split(":")[2])}
              on:toggle={() => toggleInstalledMod(item)}
              type="CUSTOM"
              modVersions={null}
              mod={item} />
          {:else}
            <ModItem
              text={launcherProfile.mods
                .map(m => m.dependencies)
                .flat()
                .filter(d => !launcherProfile.mods.some(m => m.value.source.artifact.split(":")[1] == d.value.source.artifact.split(":")[1]))
                .some(d => d.value.source.artifact.split(":")[1] == item.value.source.artifact.split(":")[1])
              ? "DEPENDENCY" : "INSTALLED"}
              on:delete={() => deleteInstalledMod(item.value.source.artifact.split(":")[1])}
              on:toggle={() => toggleInstalledMod(item)}
              on:changeVersion={(data) => changeModVersion(item.value.source.artifact.split(":")[1], data.detail.version)}
              on:getVersions={async () => await getModVersions(item.value.source.artifact.split(":")[1])}
              type="INSTALLED"
              bind:modVersions={modVersions}
              mod={item} />
          {/if}
        {/each}
      </div>
    {:else}
      <h1 class="loading-indicator">{launcherProfile.mods.length < 1 ? 'No mods installed.' : 'Loading...'}</h1>
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
        width: 100%;
        padding: 1em;
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
