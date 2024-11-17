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
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

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
  let showMoreButton = false;
  let currentTabIndex = 0;
  let listScroll = 0;

  let search_offset = 0;
  let search_limit = 30;
  let search_index = "relevance";

  let filterCategories = [];
  let filters = {};

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
      profileId: launcherProfile.id
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
        addNotification(lang.addons.mods.notification.failedToInstallDueToDependencies.replace("{dependencies}", blockedDependencies.map(d => d.value.name).join(', ')), "ERROR", null, 5000);
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
      addNotification(lang.addons.mods.notification.failedToChangeVersion.notInstalled.replace("{slug}", slug));
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
        addNotification(lang.addons.mods.notification.failedToChangeVersion.incompatibleDependencies.replace("{dependencies}", blockedDependencies.map(d => d.value.name).join(', ')), "ERROR", null, 5000);
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
        return "RECOMMENDED";
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
        if (!mod.required && mod.source.repository == "modrinth") {
          const slug = mod.source.artifact.split(":")[1];
          let author;
          let iconUrl = "";
          let description = "";
          if (mod.source.repository == "modrinth") {
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
    let oldMods = mods;

    if (searchterm == "" && search_offset === 0) {
      if (baseMods == null) {
        await getBaseMods();
      }
      oldMods = baseMods;
    }

    // WENN WIR DAS NICHT MACHEN BUGGEN LIST ENTRIES INEINANDER, ICH SCHLAGE IRGENDWANN DEN TYP DER DIESE VIRTUAL LIST GEMACHT HAT
    // Update: Ich habe ne eigene Virtual List gemacht 📉
    updateMods([]);
    
    if (filters['norisk']?.enabled) {
      await tick();
      let newMods = [];
      await Promise.all(launchManifest.mods.filter(m => m.name.toLowerCase().includes(searchterm.toLowerCase())).map(async mod => {
        const slug = mod.source.artifact.split(":")[1];
        const domain = mod.source.artifact.split(":")[0];
        let modData = {
          title: mod.name,
          slug: slug,
          author: domain,   
          blacklisted: false,
          description: "",
          downloads: null,
          featured: false,
          icon_url: "",
          source: mod.source,
        };
        if (mod.source.artifact.split(':')[0].includes("norisk")) {
          modData.author = "NoRiskClient";
          modData.icon_url = "src/images/norisk_logo.png";
        } else {
          try {
            await invoke("get_mod_info", { slug }).then(async info => {
              if (info.author == null) {
                await invoke("get_mod_author", { slug }).then(author => {
                  modData.author = author ?? lang.addons.mods.unknownAuthor;
                })
              } else {
                modData.author = info.author;
              }
              
              modData.title = info.title;
              modData.icon_url = info.icon_url;
              modData.description = info.description;
              modData.downloads = info.downloads;
            });
          } catch (e) {
            // ignore in this case
          }
        }
        newMods.push(modData);
      }));
      
      console.log(newMods);
      return updateMods(newMods);
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

    noriskLog(`Searching for mods with searchterm: ${searchterm} | Limit: ${search_limit} | Offset: ${search_offset} | Filters: ${Object.values(filters).filter(f => f.enabled).map(f => f.id).join(", ")}`);
    await invoke("search_mods", {
      params: {
        facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:mod"], ["categories:fabric"]${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).length > 0 ? ", " : ""}${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).map(filter => `["categories:'${filter.id}'"]`).join(", ")}${client_server_side_filters}]`,
        index: search_index,
        limit: search_limit,
        offset: search_offset,
        query: searchterm,
      },
    }).then((result) => {
      console.debug("Search Mod Result", result);

      showMoreButton = result.hits.length >= search_limit;
      
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
        updateMods(result.hits);
      } else {
        updateMods([...(oldMods ?? []), ...result.hits.filter(mod => searchterm != "" || (!launchManifest.mods.some((launchManifestMod) => {
          return launchManifestMod.source.artifact.split(":")[1].toUpperCase() === mod.slug.toUpperCase() && !launchManifestMod.source.repository.includes('norisk');
        }) && !featuredMods.some((featuredMod) => {
          return featuredMod.slug.toUpperCase() === mod.slug.toUpperCase();
        })))]);
      }
    }).catch((error) => {
      addNotification(error);
    });
  }

  function loadMore() {
    search_offset += search_limit;
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
      profileId: launcherProfile.id,
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
        filters: [{ name: lang.addons.mods.selectCustomModFileExtentionFilterName, extensions: ["jar"] }],
      });
      if (locations instanceof Array) {
        installCustomMods(locations);
      }
    } catch (error) {
      addNotification(lang.addons.mods.notification.failedToSelectCustomMods.replace("{error}", error));
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
        addNotification(lang.addons.mods.notification.invalidCustomModFileExtention.replace("{fileName}", fileName));
        return;
      }

      if (customModFiles.includes(fileName)) {
        addNotification(lang.addons.mods.notification.customModFileAlreadyExists.replace("{fileName}", fileName));
        return;
      }

      noriskLog(`Installing custom Mod ${fileName}`);
      await invoke("save_custom_mod_to_folder", {
        options: options,
        profileId: launcherProfile.id,
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
              artifact: `CUSTOM:${launcherProfile.id}:${fileName}`,
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
    filterCategories = [
      {
        type: lang.addons.mods.filters.environments.title,
        entries: [
          { id: "client_side", name: lang.addons.mods.filters.environments.client },
          { id: "server_side", name: lang.addons.mods.filters.environments.server },
        ],
      },
      {
        type: lang.addons.mods.filters.noriskclient.title,
        entries: [
          { id: "norisk", name: lang.addons.mods.filters.noriskclient.mods },
        ]
      },
      {
        type: lang.addons.mods.filters.categories.title,
        entries: [
          { id: "adventure", name: lang.addons.mods.filters.categories.adventure },
          { id: "cursed", name: lang.addons.mods.filters.categories.cursed },
          { id: "decoration", name: lang.addons.mods.filters.categories.decoration },
          { id: "economy", name: lang.addons.mods.filters.categories.economy },
          { id: "equipment", name: lang.addons.mods.filters.categories.equipment },
          { id: "food", name: lang.addons.mods.filters.categories.food },
          { id: "game-mechanics", name: lang.addons.mods.filters.categories.gameMechanics },
          { id: "library", name: lang.addons.mods.filters.categories.library },
          { id: "magic", name: lang.addons.mods.filters.categories.magic },
          { id: "management", name: lang.addons.mods.filters.categories.management },
          { id: "minigame", name: lang.addons.mods.filters.categories.minigame },
          { id: "mobs", name: lang.addons.mods.filters.categories.mobs },
          { id: "optimization", name: lang.addons.mods.filters.categories.optimization },
          { id: "social", name: lang.addons.mods.filters.categories.social },
          { id: "storage", name: lang.addons.mods.filters.categories.storage },
          { id: "technology", name: lang.addons.mods.filters.categories.technology },
          { id: "transportation", name: lang.addons.mods.filters.categories.transportation },
          { id: "utility", name: lang.addons.mods.filters.categories.utility },
          { id: "worldgen", name: lang.addons.mods.filters.categories.worldgen },
        ],
      },
    ];
    if (!isServersideInstallation) {
      filterCategories.shift();
    } else {
      filterCategories = filterCategories.filter(category => category.type !== lang.addons.mods.filters.noriskclient.title);
    }
   
    load();
  });
</script>

<div class="modrinth-wrapper">
  <div class="navbar">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 0} on:click={() => {currentTabIndex = 0, listScroll = 0}}>{lang.addons.global.navbar.discover}</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class:primary-text={currentTabIndex === 1} on:click={() => {currentTabIndex = 1, listScroll = 0}}>{lang.addons.global.navbar.installed}</h1>
    <h2>|</h2>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:click={handleSelectCustomMods}>{lang.addons.global.navbar.button.custom}</h1>
  </div>
  {#if currentTabIndex === 0}
    <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            listScroll = 0;
            searchMods();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters}
                       bind:options={options} placeHolder={lang.addons.mods.searchbar.modrinth.placeholder} />
    {#if mods !== null && mods.length > 0 }
      <div id="scrollList" class="scrollList" on:scroll={() => listScroll = document.getElementById('scrollList').scrollTop ?? 0}>
        {#each [...mods, showMoreButton && !filters['norisk']?.enabled ? 'LOAD_MORE_MODS' : null] as item}
          {#if item === 'LOAD_MORE_MODS'}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="load-more-button" on:click={loadMore}><p class="primary-text">{lang.addons.global.button.loadMore}</p></div>
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
      <h1 class="loading-indicator">{mods == null ? lang.addons.mods.noModsFound : lang.addons.global.loading}</h1>
    {/if}
  {:else if currentTabIndex === 1}
    <ModrinthSearchBar on:search={async () => {
      const prev = launcherProfile.mods;
      launcherProfile.mods = [];
      await tick();
      launcherProfile.mods = prev;
    }} bind:searchTerm={filterterm} placeHolder={lang.addons.mods.searchbar.installed.placeholder} />
    {#if launcherProfile.mods.filter(mod => !mod.value.source.artifact.includes("PLACEHOLDER")).length > 0}
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
      <h1 class="loading-indicator">{launcherProfile.mods.filter(mod => !mod.value.source.artifact.includes("PLACEHOLDER")).length < 1 ? lang.addons.mods.noModsInstalled : lang.addons.global.loading}</h1>
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
