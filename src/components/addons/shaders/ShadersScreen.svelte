<script>
    import {invoke} from "@tauri-apps/api";
    import {removeFile} from '@tauri-apps/api/fs';
    import {open} from "@tauri-apps/api/dialog";
    import VirtualList from "../../utils/VirtualList.svelte";
    import ModrinthSearchBar from "../widgets/ModrinthSearchBar.svelte";
    import ShaderItem from "./ShaderItem.svelte";
    import {createEventDispatcher, onDestroy} from "svelte";
    import {watch} from "tauri-plugin-fs-watch-api";
    import {listen} from '@tauri-apps/api/event';

    const dispatch = createEventDispatcher()

    export let currentBranch;
    export let options;
    export let launcherProfiles;
    let launcherProfile = null;
    let customShaders = [];
    let shaders = [];
    let launchManifest = null;
    let searchterm = "";
    let filterterm = "";
    let currentTabIndex = 0;
    let fileWatcher;

    let search_offset = 0;
    let search_limit = 30;
    let search_index = "relevance";

    const loginData = options.accounts.find(obj => obj.uuid === options.currentUuid);

    listen('tauri://file-drop', files => {
        if (currentTabIndex != 1) {
            return;
        }
        installCustomShaders(files.payload)
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
            getCustomShadersFilenames()
            createFileWatcher()
        }).catch((err) => {
            console.error(err);
        });
    }

    async function getCustomShadersFilenames() {
        await invoke("get_custom_shaders_filenames", {
            options: options,
            branch: launchManifest.build.branch,
            profile: launcherProfile
        }).then((shaders) => {
            console.debug("Custom Shaders", shaders)
            customShaders = shaders;
        }).catch((error) => {
            alert(error)
        })
    }

    async function installShader(shader) {
        shader.loading = true
        shaders = shaders
        await invoke("install_shader", {
            slug: shader.slug,
            params: `?game_versions=["${launchManifest.build.mcVersion}"]`
        }).then((result) => {
            launcherProfile.shaders.pushIfNotExist(result, function (e) {
                return e.slug === result.slug;
            })
            shader.loading = false;
            shaders = shaders;
            launcherProfile.shaders = launcherProfile.shaders;
            launcherProfiles.store();
        }).catch((err) => {
            console.error(err);
        });
    }

    function checkIfRequiredOrInstalled(slug) {
        // Später required shaders!?!?!??! Eig unnötig oder?
        // if (launchManifest.shaders.some((shader) => {
        //     return shader.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        // })) {
        //     if (launchManifest.mods.find((mod) =>
        //         mod.source.artifact.split(":")[1].toUpperCase() === slug.toUpperCase()
        //     ).required) {
        //         return "REQUIRED"
        //     } else {
        //         return "RECOMENDED"
        //     }
        // }

        if (launcherProfile.shaders.some((shader) => {
            return shader.slug.toUpperCase() === slug.toUpperCase()
        })) {
            return "INSTALLED"
        }
        return "INSTALL"
    }

    async function searchShaders() {
        // if (searchterm === "") {
            // Fetch featured shders
            // Wollen wir das für shader?
        //     await invoke("get_featured_mods", {
        //         branch: currentBranch,
        //         mcVersion: launchManifest.build.mcVersion,
        //     }).then((result) => {
        //         console.debug("Featured Mods", result);
        //         mods = result;
        //         launchManifest.mods.forEach(async mod => {
        //             if (!mod.required) {
        //                 const slug = mod.source.artifact.split(':')[1];
        //                 let iconUrl = 'https://norisk.gg/icon_512px.png';
        //                 let description = 'A custom NoRiskClient Mod.';
        //                 if (mod.source.repository != 'norisk') {
        //                     await invoke('get_mod_info', { slug }).then(info => {
        //                         iconUrl = info.icon_url;
        //                         description = info.description;
        //                     }).catch((err) => {
        //                         console.error(err);
        //                     });
        //                 }
        //                 mods.push({
        //                     author: null,
        //                     description: description,
        //                     icon_url: iconUrl,
        //                     slug: slug,
        //                     title: mod.name
        //                 });
        //             }
        //         });
        //     }).catch((err) => {
        //         console.error(err);
        //     });
        //     return;
        // }

        await invoke("search_shaders", {
            params: {
                facets: `[["versions:${launchManifest.build.mcVersion}"], ["project_type:shader"]]`,
                index: search_index,
                limit: search_limit,
                offset: search_offset,
                query: searchterm,
            },
        }).then((result) => {
            console.debug("Search Shader Result", result);
            if (result.hits.length === 0) {
                shaders = null;
            } else if (search_offset == 0) {
                shaders = result.hits;
            } else {
                shaders = [...shaders, ...result.hits];
            }
        }).catch((err) => {
            console.error(err);
        });
    }

    function loadMore() {
        search_offset += search_limit;
        searchShaders();
    }

    async function deleteInstalledShader(shader) {
        let index = launcherProfile.shaders.findIndex((element) => {
            return element.slug.toUpperCase() === (shader?.slug ?? shader).toUpperCase()
        })
        if (index !== -1) {
            launcherProfile.shaders.splice(index, 1);
            deleteShaderFile(shader?.file_name ?? shader);
            shaders = shaders
            launcherProfiles.store();
        } else {
            deleteShaderFile(shader);
        }
    }

    async function deleteShaderFile(filename) {
        await invoke("get_custom_shaders_folder", {
            options: options,
            branch: launchManifest.build.branch
        }).then(async (folder) => {
            await removeFile(folder + "/" + filename).then(() => {
                getCustomShadersFilenames()
            }).catch((error) => {
                alert(error)
            })
        }).catch((error) => {
            alert(error)
        })
    }

    async function createFileWatcher() {
        await invoke("get_custom_shaders_folder", {
            options: options,
            branch: launchManifest.build.branch
        }).then(async (folder) => {
            console.debug("File Watcher Folder", folder)
            // can also watch an array of paths
            fileWatcher = await watch(
                folder,
                getCustomShadersFilenames,
                {recursive: true}
            );
        }).catch((error) => {
            alert(error)
        })
    }

    async function handleSelectCustomShaders() {
        try {
            const locations = await open({
                defaultPath: '/',
                multiple: true,
                filters: [{name:"Shaders", extensions: ["zip"]}]
            })
            if (locations instanceof Array) {
                installCustomShaders(locations)
            }
        } catch (e) {
            alert("Failed to select file using dialog")
        }
    }

    async function installCustomShaders(locations) {
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
            console.log(`Installing custom Shader ${fileName}`)
            await invoke("save_custom_shaders_to_folder", {
                options: options,
                branch: launchManifest.build.branch,
                file: {name: fileName, location: location}
            }).catch((error) => {
                alert(error)
            });
            getCustomShadersFilenames()
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
        searchShaders();
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
        <h1 on:click={handleSelectCustomShaders}>Custom</h1>
    </div>
    {#if currentTabIndex === 0}
        <ModrinthSearchBar on:search={() => {
            search_offset = 0;
            searchShaders();
        }} bind:searchTerm={searchterm} placeHolder="Search for Shaders on Modrinth..."/>
        {#if shaders !== null && shaders.length > 0 }
        <VirtualList height="30em" items={[...shaders, shaders.length >= 30 ? 'LOAD_MORE_SHADERS' : null]} let:item>
            {#if item == 'LOAD_MORE_SHADERS'}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div class="load-more-button" on:click={loadMore}><p>LOAD MORE</p></div>
                    {:else if item != null}
                        <ShaderItem text={checkIfRequiredOrInstalled(item.slug)}
                            on:delete={() => deleteInstalledShader(item)}
                            on:install={() => installShader(item)}
                            type="RESULT"
                            shader={item}/>
                    {/if}
            </VirtualList>
        {:else}
            <h1 style="display: flex; justify-content: center; align-items: center; font-family: 'Press Start 2P', serif;">{shaders == null ? 'No shaders found.' : 'Loading...'}</h1>
        {/if}
    {:else if currentTabIndex === 1}
        <ModrinthSearchBar on:search={() => {}} bind:searchTerm={filterterm} placeHolder="Filter installed Shaders..."/>
        {#if launcherProfile.shaders.length > 0 || customShaders.length > 0}
            <VirtualList height="30em" items={[...customShaders,...launcherProfile.shaders].filter((shader) => {
                let name = (shader?.title ?? shader).toUpperCase()
                return (shader?.title != null || name.endsWith(".ZIP")) && name.includes(filterterm.toUpperCase())
            }).sort() } let:item>
                {#if (typeof item === 'string' || item instanceof String)}
                    <ShaderItem text="INSTALLED"
                        on:delete={() => deleteInstalledShader(item)}
                        on:install={() => {}}
                        type="CUSTOM"
                        shader={item}/>
                {:else}
                    <ShaderItem text="INSTALLED"
                        on:delete={() => deleteInstalledShader(item)}
                        on:install={() => {}}
                        type="INSTALLED"
                        shader={item}/>
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
