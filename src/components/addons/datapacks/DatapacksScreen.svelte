<script>
    import {invoke} from "@tauri-apps/api";
    import {removeFile} from '@tauri-apps/api/fs';
    import {open} from "@tauri-apps/api/dialog";
    import VirtualList from "../../utils/VirtualList.svelte";
    import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
    import DatapackItem from "./DatapackItem.svelte";
    import {createEventDispatcher, onDestroy} from "svelte";
    import {watch} from "tauri-plugin-fs-watch-api";
    import {listen} from '@tauri-apps/api/event';

    const dispatch = createEventDispatcher()

    export let currentBranch;
    export let options;
    export let launcherProfiles;
    export let world;
    let launcherProfile = null;
    let customDatapacks = [];
    let featuredDatapacks = [];
    let datapacks = [];
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
        installCustomDatapacks(files.payload)
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
        }).then((result) => {
            console.debug("Launch Manifest", result);
            launchManifest = result
            getCustomDatapacksFilenames()
            createFileWatcher()
        }).catch((err) => {
            console.error(err);
        });
    }

    async function getCustomDatapacksFilenames() {
        await invoke("get_custom_datapacks_filenames", {
            options: options,
            branch: launchManifest.build.branch,
            installedDatapacks: launcherProfiles.addons[currentBranch].datapacks,
            world: world
        }).then((datapacks) => {
            console.debug("Custom Datapacks", datapacks)
            customDatapacks = datapacks;
        }).catch((error) => {
            alert(error)
        })
    }

    async function installDatapack(datapack) {
        datapack.loading = true
        datapacks = datapacks
        await invoke("install_datapack", {
            slug: datapack.slug,
            params: `?game_versions=["${launchManifest.build.mcVersion}"]&loaders=["datapack"]`,
            world: world
        }).then((result) => {
            launcherProfiles.addons[currentBranch].datapacks.pushIfNotExist(result, function (e) {
                return e.slug === result.slug && e.world_name === world;
            })
            datapack.loading = false;
            datapacks = datapacks;
            launcherProfiles.addons[currentBranch].datapacks = launcherProfiles.addons[currentBranch].datapacks;
            launcherProfiles.store();
        }).catch((err) => {
            console.error(err);
        });
    }

    function checkIfRequiredOrInstalled(slug) {
        if (launcherProfiles.addons[currentBranch].datapacks.some((datapack) => {
            return datapack.slug.toUpperCase() === slug.toUpperCase() && datapack.world_name === world
        })) {
            return "INSTALLED"
        }
        return "INSTALL"
    }

    async function searchDatapacks() {
        if (searchterm === "" && search_offset === 0) {
            await invoke("get_featured_datapacks", {
                branch: currentBranch,
                mcVersion: launchManifest.build.mcVersion,
            }).then((result) => {
                console.debug("Featured Datapacks", result);
                result.forEach(datapack => datapack.featured = true);
                datapacks = result;
                featuredDatapacks = result;
            }).catch((err) => {
                console.error(err);
            });
        }

        await invoke("search_datapacks", {
            params: {
                facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:datapack"], ["categories:'datapack'"]${Object.values(filters).filter(filter => filter.enabled).length > 0 ? ', ' : ''}${Object.values(filters).filter(filter => filter.enabled).map(filter => `["categories:'${filter.id}'"]`).join(', ')}]`,
                index: search_index,
                limit: search_limit,
                offset: search_offset,
                query: searchterm,
            },
        }).then((result) => {
            console.debug("Search Datapack Result", result);
            result.hits.forEach(datapack => {
                datapack.featured = featuredDatapacks.filter(featuredDatapack => featuredDatapack.slug === datapack.slug).length > 0;
            });
            if (result.hits.length === 0) {
                datapacks = null;
            } else if ((search_offset == 0 && searchterm != '') || Object.values(filters).length > 0) {
                datapacks = result.hits;
            } else {
                datapacks = [...datapacks, ...result.hits.filter(datapack => searchterm != '' || !featuredDatapacks.some((element) => element.slug === datapack.slug))];
            }
        }).catch((err) => {
            console.error(err);
        });
    }

    function loadMore() {
        search_offset += search_limit;
        searchDatapacks();
    }

    async function deleteInstalledDatapack(datapack) {
        let index = launcherProfiles.addons[currentBranch].datapacks.findIndex((element) => {
            return element.slug.toUpperCase() === (datapack?.slug ?? datapack).toUpperCase() && element.world_name === world
        })

        if (index !== -1) {
            launcherProfiles.addons[currentBranch].datapacks.splice(index, 1);
            deleteDatapackFile(datapack?.file_name ?? datapack, false);
            datapacks = datapacks;
            launcherProfiles.addons[currentBranch].datapacks = launcherProfiles.addons[currentBranch].datapacks;
            launcherProfiles.store();
        } else {
            deleteDatapackFile(datapack);
        }
    }

    async function deleteDatapackFile(filename, showError = true) {
        await invoke("get_custom_datapacks_folder", {
            options: options,
            branch: launchManifest.build.branch,
            world: world
        }).then(async (folder) => {
            await removeFile(folder + "/" + filename).then(() => {
                getCustomDatapacksFilenames()
            }).catch((error) => {
                if (!showError) return;
                alert(error)
            })
        }).catch((error) => {
            alert(error)
        })
    }

    async function createFileWatcher() {
        await invoke("get_custom_datapacks_folder", {
            options: options,
            branch: launchManifest.build.branch,
            world: world
        }).then(async (folder) => {
            console.debug("File Watcher Folder", folder)
            // can also watch an array of paths
            fileWatcher = await watch(
                folder,
                getCustomDatapacksFilenames,
                {recursive: true}
            );
        }).catch((error) => {
            alert(error)
        })
    }

    async function handleSelectCustomDatapacks() {
        try {
            const locations = await open({
                defaultPath: '/',
                multiple: true,
                filters: [{name:"Datapacks", extensions: ["zip"]}]
            })
            if (locations instanceof Array) {
                installCustomDatapacks(locations)
            }
        } catch (e) {
            alert("Failed to select file using dialog")
        }
    }

    async function installCustomDatapacks(locations) {
        locations.forEach(async (location) => {
            if (!location.endsWith(".zip")) {
                return;
            }
            let splitter = ""
            if (location.split("/")[0] == "") {
                splitter = "/"
            } else {
                splitter = "\\"
            }
            const fileName = location.split(splitter)[location.split(splitter).length - 1];
            console.log(`Installing custom Datapack ${fileName}`)
            await invoke("save_custom_datapacks_to_folder", {
                options: options,
                branch: launchManifest.build.branch,
                file: {name: fileName, location: location},
                world: world
            }).catch((error) => {
                alert(error)
            });
            getCustomDatapacksFilenames()
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
        searchDatapacks();
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
        <h1 on:click={handleSelectCustomDatapacks}>Custom</h1>
    </div>
    {#if currentTabIndex === 0}
        <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            searchDatapacks();
        }} bind:searchTerm={searchterm} bind:filterCategories={filterCategories} bind:filters={filters} bind:options={options} placeHolder="Search for Datapacks on Modrinth..."/>
        {#if datapacks !== null && datapacks.length > 0 }
            <VirtualList height="30em" items={[...datapacks, datapacks.length >= 30 ? 'LOAD_MORE_DATAPACKS' : null]} let:item>
                {#if item == 'LOAD_MORE_DATAPACKS'}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <div class="load-more-button" on:click={loadMore}><p>LOAD MORE</p></div>
                    {:else if item != null}
                        <DatapackItem text={checkIfRequiredOrInstalled(item.slug)}
                            on:delete={() => deleteInstalledDatapack(item)}
                            on:install={() => installDatapack(item)}
                            type="RESULT"
                            datapack={item}/>
                {/if}
            </VirtualList>
        {:else}
            <h1 class="loading-indicator">{datapacks == null ? 'No Datapacks found.' : 'Loading...'}</h1>
        {/if}
    {:else if currentTabIndex === 1}
        <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm} placeHolder="Filter installed Datapacks..."/>
        {#if launcherProfiles.addons[currentBranch].datapacks.length > 0 || datapacks.length > 0}
            <VirtualList height="30em" items={[...customDatapacks,...launcherProfiles.addons[currentBranch].datapacks].filter((datapack) => {
                let name = (datapack?.title ?? datapack).toUpperCase()
                return (datapack?.title != null || name.endsWith(".ZIP")) && name.includes(filterterm.toUpperCase()) && (datapack?.world_name == undefined || datapack.world_name === world)
            }).sort((a, b) => (a?.title ?? a).localeCompare(b?.title ?? b)) } let:item>
                {#if (typeof item === 'string' || item instanceof String)}
                    <DatapackItem text="INSTALLED"
                        on:delete={() => deleteInstalledDatapack(item)}
                        type="CUSTOM"
                        datapack={item}/>
                {:else}
                    <DatapackItem text="INSTALLED"
                        on:delete={() => deleteInstalledDatapack(item)}
                        type="INSTALLED"
                        datapack={item}/>
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
