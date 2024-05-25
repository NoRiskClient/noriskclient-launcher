<script>
    import {invoke} from "@tauri-apps/api";
    import {removeFile, renameFile} from '@tauri-apps/api/fs';
    import {open} from "@tauri-apps/api/dialog";
    import VirtualList from "../../utils/VirtualList.svelte";
    import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
    import ModItem from "./ModItem.svelte";
    import {createEventDispatcher, onDestroy} from "svelte";
    import {watch} from "tauri-plugin-fs-watch-api";
    import {listen} from '@tauri-apps/api/event';

    const dispatch = createEventDispatcher()

    export let currentBranch;
    export let options;
    export let launcherProfiles;
    let launcherProfile = null;
    let customMods = [];
    let mods = [];
    let featuredMods = [];
    let launchManifest = null;
    let searchterm = "";
    let filterterm = "";
    let currentTabIndex = 0;
    let fileWatcher;

    let search_offset = 0;
    let search_limit = 30;
    let search_index = "relevance";

    let filterCategories = [
        {
            type: 'Environments',
            entries: [
                {id: 'client_side', name: 'Client',},
                {id: 'server_side', name: 'Server'}
            ]
        },
        {
            type: 'Categories',
            entries: [
                {id: 'adventure', name: 'Adventure'},
                {id: 'cursed', name: 'Cursed'},
                {id: 'decoration', name: 'Decoration'},
                {id: 'economy', name: 'Economy'},
                {id: 'equipment', name: 'Equipment'},
                {id: 'food', name: 'Food'},
                {id: 'game-mechanics', name: 'Game Mechanics'},
                {id: 'library', name: 'Library'},
                {id: 'magic', name: 'Magic'},
                {id: 'management', name: 'Management'},
                {id: 'minigame', name: 'Minigame'},
                {id: 'mobs', name: 'Mobs'},
                {id: 'optimization', name: 'Optimization'},
                {id: 'social', name: 'Social'},
                {id: 'storage', name: 'Storage'},
                {id: 'technology', name: 'Technology'},
                {id: 'transportation', name: 'Transportation'},
                {id: 'utility', name: 'Utility'},
                {id: 'worldgen', name: 'Worldgen'}
            ]
        }
    ];
    let filters = {};

    const loginData = options.accounts.find(obj => obj.uuid === options.currentUuid);

    listen('tauri://file-drop', files => {
        if (currentTabIndex != 1) {
            return;
        }
        installCustomMods(files.payload)
    })

    // check if an element exists in array using a comparer function
    // comparer : function(currentElement)
    Array.prototype.inArray = function (comparer) {
        for (let i = 0; i < this.length; i++) {
            if (comparer(this[i])) return true;
        }
        return false;
    };

    // adds an element to the array if it does not already exist using a comparer
    // function
    Array.prototype.pushIfNotExist = function (element, comparer) {
        if (!this.inArray(comparer)) {
            this.push(element);
        }
    };

    async function getLaunchManifest() {
        await invoke("get_launch_manifest", {
            branch: currentBranch,
            noriskToken: options.experimentalMode ? loginData.experimentalToken : loginData.noriskToken,
            uuid: options.currentUuid
        }).then((result) => {
            console.debug("Launch Manifest", result);
            launchManifest = result
            getCustomModsFilenames()
            createFileWatcher()
        }).catch((err) => {
            console.error(err);
        });
    }

    async function getCustomModsFilenames() {
        await invoke("get_custom_mods_filenames", {
            options: options,
            branch: launchManifest.build.branch,
            mcVersion: launchManifest.build.mcVersion
        }).then((mods) => {
            console.debug("Custom Mods", mods)
            customMods = mods;
        }).catch((error) => {
            alert(error)
        })
    }

    async function installModAndDependencies(mod) {
        await invoke("install_mod_and_dependencies", {
            slug: mod.slug,
            params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["fabric"]`,
            requiredMods: launchManifest.mods
        }).then((result) => {
            result.image_url = mod.icon_url;
            launcherProfile.mods.pushIfNotExist(result, function (e) {
                return e.value.name === result.value.name;
            })
            mod.loading = false
            mods = mods
            launcherProfile.mods = launcherProfile.mods;
            launcherProfiles.store()
        }).catch((err) => {
            console.error(err);
        });
    }

    function checkIfRequiredOrInstalled(slug) {
        if (launchManifest.mods.some((mod) => {
            return mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })) {
            if (launchManifest.mods.find((mod) =>
                mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
            ).required) {
                return "REQUIRED"
            } else {
                return "RECOMENDED"
            }
        }
        if (launcherProfile.mods.some((mod) => {
            return mod.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })) {
            return "INSTALLED"
        }
        return "INSTALL"
    }

    async function searchMods() {
        if (searchterm === "" && search_offset === 0) {
            await invoke("get_featured_mods", {
                branch: currentBranch,
                mcVersion: launchManifest.build.mcVersion,
            }).then((result) => {
                console.debug("Featured Mods", result);
                result.forEach(mod => mod.featured = true);
                mods = result;
                featuredMods = result;
                launchManifest.mods.forEach(async mod => {
                    if (!mod.required) {
                        const slug = mod.source.artifact.split(':')[1];
                        let author;
                        let iconUrl = 'src/images/norisk_logo.png';
                        let description = "A custom NoRiskClient Mod."
                        if (mod.source.repository != 'norisk') {
                            await invoke('get_mod_info', { slug }).then(info => {
                                author = info.author ?? null;
                                iconUrl = info.icon_url;
                                description = info.description;
                            }).catch((err) => {
                                console.error(err);
                            });
                        }
                        if (!mod.enabled) disableRecomendedMod(slug);
                        mods.push({
                            author: author,
                            description: description,
                            icon_url: iconUrl,
                            slug: slug,
                            title: mod.name
                        });
                    }
                });
            }).catch((err) => {
                console.error(err);
            });
        }

        let client_server_side_filters = '';
        const client_side = Object.values(filters).find(filter => filter.id == 'client_side');
        const server_side = Object.values(filters).find(filter => filter.id == 'server_side');
        if (!client_side && !server_side) {
            client_server_side_filters = '';
        } else if (client_side.enabled && server_side.enabled) {
            client_server_side_filters = ', ["client_side:required"], ["server_side:required"]';
        } else if (client_side.enabled && !server_side.enabled) {
            client_server_side_filters = ', ["client_side:optional","client_side:required"], ["server_side:optional","server_side:unsupported"]';
        } else if (!client_side.enabled && server_side.enabled) {
            client_server_side_filters = ', ["client_side:optional","client_side:unsupported"], ["server_side:optional","server_side:required"]';
        }

        const notEnvironmentFilter = (filter) => filter.id !== 'client_side' && filter.id !== 'server_side';
        
        await invoke("search_mods", {
            params: {
                facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:mod"], ["categories:fabric"]${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).length > 0 ? ', ' : ''}${Object.values(filters).filter(filter => filter.enabled && notEnvironmentFilter(filter)).map(filter => `["categories:'${filter.id}'"]`).join(', ')}${client_server_side_filters}]`,
                index: search_index,
                limit: search_limit + (searchterm == '' ? launchManifest.mods.length : 0),
                offset: search_offset,
                query: searchterm,
            },
        }).then((result) => {
            console.debug("Search Mod Result", result);
            result.hits.forEach(mod => {
                mod.featured = featuredMods.filter(featuredMod => featuredMod.slug === mod.slug).length > 0;
            });
            if (result.hits.length === 0) {
                mods = null;
            } else if ((search_offset == 0 && searchterm != '') || Object.values(filters).length > 0) {
                mods = result.hits;
            } else {
                mods = [...mods, ...result.hits.filter(mod => searchterm != '' || (!launchManifest.mods.some((launchManifestMod) => {
                    return launchManifestMod.source.artifact.split(":")[1].toUpperCase() === mod.slug.toUpperCase()
                }) && !featuredMods.some((featuredMod) => {
                    return featuredMod.slug.toUpperCase() === mod.slug.toUpperCase()})))];
            }
        }).catch((err) => {
            console.error(err);
        });
    }

    function loadMore() {
        search_offset += search_limit + (searchterm == '' ? launchManifest.mods.length : 0);
        searchMods();
    }

    async function toggleInstalledMod(mod) {
        mod.value.enabled = !mod.value.enabled;
        launcherProfile.mods = launcherProfile.mods;
        launcherProfiles.store();
        const keep = launcherProfile.mods;
        launcherProfile.mods = [];
        setTimeout(() => {
            launcherProfile.mods = keep;
        }, 0)
    }

    async function deleteInstalledMod(slug) {
        let index = launcherProfile.mods.findIndex((element) => {
            return element.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })
        if (index !== -1) {
            launcherProfile.mods.splice(index, 1);
            mods = mods;
            launcherProfile.mods = launcherProfile.mods;
            launcherProfiles.store();
        }
    }

    async function disableRecomendedMod(slug) {
        if (launcherProfile.mods.find(mod => mod.value.name.toUpperCase() === slug.toUpperCase())) {
            return;
        }
        launcherProfile.mods.push({
            title: slug,
            image_url: '',
            value: {
                required: false,
                enabled: false,
                name: slug,
                source: {
                    type: 'repository',
                    repository: '',
                    artifact: `PLACEHOLDER:${slug}`,
                    url: ''
                }
            },
            dependencies: []
        })
        mods = mods
        launcherProfile.mods = launcherProfile.mods;
        launcherProfiles.store();
    }

    async function enableRecomendedMod(slug) {
        let index = launcherProfile.mods.findIndex((element) => {
            return element.value.name.toUpperCase() === slug.toUpperCase()
        })
        if (index !== -1) {
            launcherProfile.mods.splice(index, 1);
            mods = mods
            launcherProfile.mods = launcherProfile.mods;
            launcherProfiles.store();
        }
    }

    async function deleteCustomModFile(filename) {
        await invoke("get_custom_mods_folder", {
            options: options,
            branch: launchManifest.build.branch,
            mcVersion: launchManifest.build.mcVersion
        }).then(async (folder) => {
            await removeFile(folder + "/" + filename).then(() => {
                getCustomModsFilenames()
            }).catch((error) => {
                alert(error)
            })
        }).catch((error) => {
            alert(error)
        })
    }

    async function toggleCustomModFile(filename) {
        await invoke("get_custom_mods_folder", {
            options: options,
            branch: launchManifest.build.branch,
            mcVersion: launchManifest.build.mcVersion
        }).then(async (folder) => {
            if (filename.endsWith(".disabled")) {
                await renameFile(folder + "/" + filename, folder + "/" + filename.replace('.disabled', '')).then(() => {
                    getCustomModsFilenames()
                }).catch((error) => {
                    alert(error)
                })
            } else {
                await renameFile(folder + "/" + filename, folder + "/" + filename + ".disabled").then(() => {
                    getCustomModsFilenames()
                }).catch((error) => {
                    alert(error)
                })
            }
        }).catch((error) => {
            alert(error)
        })
    }

    async function createFileWatcher() {
        await invoke("get_custom_mods_folder", {
            options: options,
            branch: launchManifest.build.branch,
            mcVersion: launchManifest.build.mcVersion
        }).then(async (folder) => {
            console.debug("File Watcher Folder", folder)
            // can also watch an array of paths
            fileWatcher = await watch(
                folder,
                getCustomModsFilenames,
                {recursive: true}
            );
        }).catch((error) => {
            alert(error)
        })
    }

    async function handleSelectCustomMods() {
        try {
            const locations = await open({
                defaultPath: '/',
                multiple: true,
                filters: [{name:"Custom Mods", extensions: ["jar"]}]
            })
            if (locations instanceof Array) {
                installCustomMods(locations)
            }
        } catch (e) {
            alert("Failed to select file using dialog")
        }
    }

    async function installCustomMods(locations) {
        locations.forEach(async (location) => {
            if (!location.endsWith(".jar")) {
                return;
            }
            let splitter = ""
            if (location.split("/")[0] == "") {
                splitter = "/"
            } else {
                splitter = "\\"
            }
            const fileName = location.split(splitter)[location.split(splitter).length - 1];
            console.log(`Installing custom Mod ${fileName}`)
            await invoke("save_custom_mods_to_folder", {
                options: options,
                branch: launchManifest.build.branch,
                mcVersion: launchManifest.build.mcVersion,
                file: {name: fileName, location: location}
            }).catch((error) => {
                alert(error)
            });
            getCustomModsFilenames()
        })
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
        searchMods();
    }

    load()

    onDestroy(() => {
        fileWatcher = null;
    })
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 class="home-button" style="left: 220px;" on:click={() => dispatch("back")}>[BACK]</h1>
<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 class="home-button" style="right: 220px;" on:click={() => dispatch("home")}>[HOME]</h1>
<div class="modrinth-wrapper">
    <div class="navbar">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class:active-tab={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>Discover</h1>
        <h2>|</h2>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class:active-tab={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>Installed</h1>
        <h2>|</h2>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 on:click={handleSelectCustomMods}>Custom</h1>
    </div>
    {#if currentTabIndex === 0}
        <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            searchMods();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters} bind:options={options} placeHolder="Search for Mods on Modrinth..."/>
        {#if mods !== null && mods.length > 0 }
            <VirtualList height="30em" items={[...mods, mods.length >= 30 ? 'LOAD_MORE_MODS' : null]} let:item>
                {#if item == 'LOAD_MORE_MODS'}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <div class="load-more-button" on:click={loadMore}><p>LOAD MORE</p></div>
                {:else if item != null}
                        <ModItem
                            text={checkIfRequiredOrInstalled(item.slug)}
                            enabled={launcherProfile.mods.find(mod => mod.value.name == item.slug)?.value?.enabled ?? true}
                            on:install={() => installModAndDependencies(item)}
                            on:enable={() => enableRecomendedMod(item.slug)}
                            on:disable={() => disableRecomendedMod(item.slug)}
                            on:delete={() => deleteInstalledMod(item.slug)}
                            type="RESULT"
                            mod={item}/>
                {/if}
            </VirtualList>
        {:else}
            <h1 class="loading-indicator">{mods == null ? 'No Mods found.' : 'Loading...'}</h1>
        {/if}
    {:else if currentTabIndex === 1}
        <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm} placeHolder="Filter installed Mods..."/>
            {#if launcherProfile.mods.length > 0 || customMods.length > 0}
            <VirtualList height="30em" items={[...customMods,...launcherProfile.mods].filter((mod) => {
                let name = (mod?.value?.name ?? mod).toUpperCase()
                return (mod?.value?.name != null || name.endsWith(".JAR") || name.endsWith(".DISABLED")) && name.includes(filterterm.toUpperCase()) && !mod?.value?.source?.artifact?.includes("PLACEHOLDER")
            }).sort((a, b) => (a?.title ?? a).localeCompare(b?.title ?? b)) } let:item>
                {#if (typeof item === 'string' || item instanceof String)}
                    <ModItem
                        text="CUSTOM"
                        enabled={!item.toUpperCase().endsWith(".DISABLED")}
                        on:delete={() => deleteCustomModFile(item)}
                        on:toggle={() => toggleCustomModFile(item)}
                        type="CUSTOM"
                        mod={item}/>
                {:else}
                    <ModItem
                        text="INSTALLED"
                        on:delete={() => deleteInstalledMod(item.value.source.artifact.split(":")[1])}
                        on:toggle={() => toggleInstalledMod(item)}
                        type="INSTALLED"
                        mod={item}/>
                {/if}
            </VirtualList>
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

    .active-tab {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
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

    .load-more-button p {
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
    }

    .modrinth-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.7em;
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
