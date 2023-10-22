<script>
    import {invoke} from "@tauri-apps/api";
    import {renameFile, removeFile} from '@tauri-apps/api/fs';
    import {open} from "@tauri-apps/api/dialog";
    import VirtualList from "../utils/VirtualList.svelte";
    import ModrinthSearchBar from "./ModrinthSearchBar.svelte";
    import ModrinthResultItem from "./ModrinthResultItem.svelte";
    import {createEventDispatcher, onDestroy} from "svelte";
    import InstalledModItem from "./InstalledModItem.svelte";
    import CustomModItem from "./CustomModItem.svelte";
    import {watch} from "tauri-plugin-fs-watch-api";
    import { listen } from '@tauri-apps/api/event';

    const dispatch = createEventDispatcher()

    export let currentBranch;
    export let options;
    let installedMods = {mods: []};
    let customMods = [];
    let mods = null;
    let launchManifest = null;
    let searchterm = "";
    let filterterm = "";
    let currentTabIndex = 0;
    let fileWatcher;

    console.debug("Branch", currentBranch)

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

    async function loadInstalledModsConfig() {
        await invoke("get_installed_mods", {
            branch: currentBranch,
            options: options
        }).then(result => {
            console.debug("Installed Mods", result)
            installedMods = result
        }).catch(err => {
            alert(err)
        })
    }

    async function storeInstalledMods(mods, branch, options) {
        await invoke("store_installed_mods", {
            installedMods: mods,
            branch: branch,
            options: options,
        }).then(() => {
            console.debug("Stored Installed Mods...", mods)
        }).catch(e => console.error(e));
    }

    async function getLaunchManifest() {
        await invoke("get_launch_manifest", {
            branch: currentBranch,
        }).then((result) => {
            console.debug("Launch Manifest", result);
            launchManifest = result
            getCustomModsFilenames()
            createFileWatcher()
        }).catch((err) => {
            console.error(err);
        });
    }

    async function fetchModVersion(slug) {
        console.debug("Slug", slug)
        await invoke("get_mod_version", {
            slug: slug,
            params: `?game_versions=["1.20.1"]`,
        }).then((result) => {
            console.debug("Mod Version", result);
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
        mod.loading = true
        mods = mods
        await invoke("install_mod_and_dependencies", {
            slug: mod.slug,
            params: `?game_versions=["1.20.1"]&loaders=["fabric"]`,
            requiredMods: launchManifest.mods
        }).then((result) => {
            result.image_url = mod.icon_url
            installedMods.mods.pushIfNotExist(result, function (e) {
                return e.value.name === result.value.name;
            })
            installedMods = installedMods;
            mod.loading = false
            mods = mods
            storeInstalledMods(installedMods, currentBranch, options);
        }).catch((err) => {
            console.error(err);
        });
    }

    function checkIfRequiredOrInstalled(slug) {
        if (launchManifest.mods.some((mod) => {
            return mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })) {
            return "REQUIRED"
        }
        if (installedMods.mods.some((mod) => {
            return mod.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })) {
            return "INSTALLED"
        }
        return "INSTALL"
    }

    async function searchMods() {
        await invoke("search_mods", {
            params: {
                //TODO mc version
                facets: `[["categories:fabric"], ["versions:1.20.1"], ["project_type:mod"]]`,
                limit: 30,
                query: searchterm,
            },
        }).then((result) => {
            console.debug("Search Mod Result", result);
            mods = result.hits;
        }).catch((err) => {
            console.error(err);
        });
    }

    async function deleteInstalledMod(slug) {
        let index = installedMods.mods.findIndex((element) => {
            return element.value.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        })
        if (index !== -1) {
            installedMods.mods.splice(index, 1);
            installedMods = installedMods;
            mods = mods
            await storeInstalledMods(installedMods, currentBranch, options).then(() => {
                installedMods.mods = installedMods.mods
            })
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
                await renameFile(folder + "/" + filename, folder + "/" + filename.replace(".disabled", "")).then(() => {
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
                (event) => {
                    const {type, payload} = event;
                    getCustomModsFilenames()
                },
                {recursive: true}
            );
        }).catch((error) => {
            alert(error)
        })
    }

    async function handleSelectCustomMods() {
        console.debug("Launch", launchManifest)
        try {
            const locations = await open({
                defaultPath: '',
                multiple: true,
                filters: [{name:"Mods", extensions: ["jar"]}]
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
            const fileName = location.split("\\")[location.split("\\").length - 1];
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


    searchMods();
    loadInstalledModsConfig();
    getLaunchManifest();

    onDestroy(() => {
        fileWatcher();
    })
</script>

<h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>
<div class="modrinth-wrapper">
    <div class="navbar">
        <h1 class:active-tab={currentTabIndex === 0} on:click={() => currentTabIndex = 0}>Discover</h1>
        <h2>|</h2>
        <h1 class:active-tab={currentTabIndex === 1} on:click={() => currentTabIndex = 1}>Installed</h1>
        <h2>|</h2>
        <h1 on:click={handleSelectCustomMods}>Custom</h1>
    </div>
    {#if currentTabIndex === 0}
        <ModrinthSearchBar on:search={searchMods} bind:searchTerm={searchterm}
                           placeHolder="Search for Mods on Modrinth..."/>
        {#if mods !== null }
            <VirtualList height="30em" items={mods} let:item>
                <ModrinthResultItem text={checkIfRequiredOrInstalled(item.slug)}
                                    on:delete={deleteInstalledMod(item.slug)}
                                    on:install={installModAndDependencies(item)}
                                    mod={item}/>
            </VirtualList>
        {/if}
    {:else if currentTabIndex === 1}
        <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm}
                           placeHolder="Filter installed Mods..."/>
        {#if installedMods.mods.length > 0 || customMods.length > 0}
            <VirtualList height="30em" items={[...customMods,...installedMods.mods].filter((mod) => {
                let name = (mod?.value?.name ?? mod).toUpperCase()
                console.debug("Name",name)
                return (name.endsWith(".JAR") || name.endsWith(".DISABLED")) && name.includes(filterterm.toUpperCase())
            }).sort() } let:item>
                {#if (typeof item === 'string' || item instanceof String)}
                    <CustomModItem on:delete={deleteCustomModFile(item)} on:togglemod={toggleCustomModFile(item)}
                                   mod={item}/>
                {:else}
                    <InstalledModItem on:delete={deleteInstalledMod(item.value.source.artifact.split(":")[1])} mod={item}/>
                {/if}
            </VirtualList>
        {:else}

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
