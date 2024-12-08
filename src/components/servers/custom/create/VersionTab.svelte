<script>
    import { invoke } from "@tauri-apps/api";
    import { createEventDispatcher } from "svelte";
    import { addNotification } from "../../../../stores/notificationStore.js";
    import { translations } from '../../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    const dispatch = createEventDispatcher()

    export let type;
    export let availableTypes;
    export let version;
    export let majorVersion;
    let showSubVersions = false;

    async function load() {
        if (type == "VANILLA" && availableTypes["VANILLA"].versions.length <= 0) {
            await invoke("get_all_vanilla_versions").then((response) => {
                let versions = response.versions.filter(v => v.type == 'release');
                versions.forEach(v => {
                    if (versions.filter(vers => v.id.split('.')[1] == (vers.id.split('.')[1]?.split('-')[0] ?? vers.id.split('.')[1]) && vers.id.split('.').length == 2).length == 0) {
                        versions.push({ id: v.id.split('.')[0] + '.' + v.id.split('.')[1] + '-FILLER', url: v.url });
                    }
                });
                versions.filter(v => (v.id.split('.').length == 2) && parseInt(v.id.split('.')[1]) >= 7).forEach(version => {
                    availableTypes["VANILLA"].versions.push({
                        "name": version.id.split('.')[0] + '.' + version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1],
                        "versions": versions.filter(v => v.id.split('.')[1] == version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1]).reverse().map(v => {
                            return { name: v.id, hash: v.url.split('//')[1].split('/')[3] }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get vanilla versions: " + error);
            });
        } else if (type == "FABRIC" && availableTypes["FABRIC"].versions.length <= 0) {
            await invoke("get_all_fabric_game_versions").then((response) => {
                let versions = response.filter(v => v.stable == true);
                versions.forEach(v => {
                    if (versions.filter(vers => v.version.split('.')[1] == (vers.version.split('.')[1]?.split('-')[0] ?? vers.version.split('.')[1]) && vers.version.split('.').length == 2).length == 0) {
                        versions.push({ version: v.version.split('.')[0] + '.' + v.version.split('.')[1] + '-FILLER' });
                    }
                });
                versions.filter(v => (v.version.split('.').length == 2)).sort((a, b) => (a.version.split('.')[1]?.split('-')[0] ?? a.version.split('.')[1])  - (b.version.split('.')[1]?.split('-')[0] ?? b.version.split('.')[1])).reverse().forEach(version => {
                    availableTypes["FABRIC"].versions.push({
                        "name": version.version.split('.')[0] + '.' + version.version.split('.')[1]?.split('-')[0] ?? version.version.split('.')[1],
                        "versions": versions.filter(v => v.version.split('.')[1] == version.version.split('.')[1]?.split('-')[0] ?? version.version.split('.')[1]).reverse().map(v => {
                            return { name: v.version }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get fabric versions: " + error);
            });
        } else if (type == "QUILT" && availableTypes["QUILT"].versions.length <= 0) {
            await invoke("get_quilt_manifest").then((response) => {
                availableTypes["QUILT"]["loaders_manifest"] = response.gameVersions[0]; // Set to keep for loader screen later
                response.gameVersions.shift();
                let versions = response.gameVersions.filter(v => v.stable);
                versions.forEach(v => {
                    if (versions.filter(vers => v.id.split('.')[1] == (vers.id.split('.')[1]?.split('-')[0] ?? vers.id.split('.')[1]) && vers.id.split('.').length == 2).length == 0) {
                        versions.push({ id: v.id.split('.')[0] + '.' + v.id.split('.')[1] + '-FILLER' });
                    }
                });
                versions.filter(v => v.id.split('.').length == 2).sort((a, b) => (a.id.split('.')[1]?.split('-')[0] ?? a.id.split('.')[1])  - (b.id.split('.')[1]?.split('-')[0] ?? b.id.split('.')[1])).reverse().forEach(version => {
                    availableTypes["QUILT"].versions.push({
                        "name": version.id.split('.')[0] + '.' + version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1],
                        "versions": versions.filter(v => v.id.split('.')[1] == (version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1])).reverse().map(v => {
                            return { name: v.id }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get quilt versions: " + error);
            });
        } else if (type == "FORGE" && availableTypes["FORGE"].versions.length <= 0) {
            await invoke("get_forge_manifest").then((response) => {
                availableTypes["FORGE"]["loaders_manifest"] = response.gameVersions; // Set to keep for loader screen later
                let versions = response.gameVersions.filter(v => v.stable == true && parseInt(v.id.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.id.split('.')[1] == (vers.id.split('.')[1]?.split('-')[0] ?? vers.id.split('.')[1]) && vers.id.split('.').length == 2).length == 0) {
                        versions.push({ id: v.id.split('.')[0] + '.' + v.id.split('.')[1] + '-FILLER' });
                    }
                });
                versions.filter(v => v.id.split('.').length == 2).sort((a, b) => (a.id.split('.')[1]?.split('-')[0] ?? a.id.split('.')[1])  - (b.id.split('.')[1]?.split('-')[0] ?? b.id.split('.')[1])).reverse().forEach(version => {
                    availableTypes["FORGE"].versions.push({
                        "name": version.id.split('.')[0] + '.' + version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1],
                        "versions": versions.filter(v => v.id.split('.')[1] == version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1]).reverse().map(v => {
                            return { name: v.id }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get forge versions: " + error);
            });
        } else if (type == "NEO_FORGE" && availableTypes["NEO_FORGE"].versions.length <= 0) {
            await invoke("get_neoforge_manifest").then((response) => {
                availableTypes["NEO_FORGE"]["loaders_manifest"] = response.gameVersions; // Set to keep for loader screen later
                let versions = response.gameVersions.filter(v => v.stable == true && parseInt(v.id.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.id.split('.')[1] == (vers.id.split('.')[1]?.split('-')[0] ?? vers.id.split('.')[1]) && vers.id.split('.').length == 2).length == 0) {
                        versions.push({ id: v.id.split('.')[0] + '.' + v.id.split('.')[1] + '-FILLER' });
                    }
                });
                versions.filter(v => v.id.split('.').length == 2).sort((a, b) => (a.id.split('.')[1]?.split('-')[0] ?? a.id.split('.')[1])  - (b.id.split('.')[1]?.split('-')[0] ?? b.id.split('.')[1])).reverse().forEach(version => {
                    availableTypes["NEO_FORGE"].versions.push({
                        "name": version.id.split('.')[0] + '.' + version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1],
                        "versions": versions.filter(v => v.id.split('.')[1] == version.id.split('.')[1]?.split('-')[0] ?? version.id.split('.')[1]).reverse().map(v => {
                            return { name: v.id }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get neoforge versions: " + error);
            });
        } else if (type == "PAPER" && availableTypes["PAPER"].versions.length <= 0) {
            await invoke("get_all_paper_game_versions").then((response) => {
                let versions = response.versions.filter(v => !v.includes('-') && parseInt(v.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.split('.')[1] == (vers.split('.')[1]?.split('-')[0] ?? vers.split('.')[1]) && vers.split('.').length == 2).length == 0) {
                        versions.push(v.split('.')[0] + '.' + v.split('.')[1] + '-FILLER');
                    }
                });
                versions.filter(v => v.split('.').length == 2).sort((a, b) => (a.split('.')[1]?.split('-')[0] ?? a.split('.')[1])  - (b.split('.')[1]?.split('-')[0] ?? b.split('.')[1])).reverse().forEach(version => {
                    availableTypes["PAPER"].versions.push({
                        "name": version.split('.')[0] + '.' + version.split('.')[1]?.split('-')[0] ?? version.split('.')[1],
                        "versions": versions.filter(v => v.split('.')[1] == version.split('.')[1]?.split('-')[0] ?? version.split('.')[1]).reverse().map(v => {
                            return { name: v }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get paper versions: " + error);
            });
        } else if (type == "FOLIA" && availableTypes["FOLIA"].versions.length <= 0) {
            await invoke("get_all_folia_game_versions").then((response) => {
                let versions = response.versions.filter(v => !v.includes('-') && parseInt(v.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.split('.')[1] == (vers.split('.')[1]?.split('-')[0] ?? vers.split('.')[1]) && vers.split('.').length == 2).length == 0) {
                        versions.push(v.split('.')[0] + '.' + v.split('.')[1] + '-FILLER');
                    }
                });
                versions.filter(v => v.split('.').length == 2).sort((a, b) => (a.split('.')[1]?.split('-')[0] ?? a.split('.')[1])  - (b.split('.')[1]?.split('-')[0] ?? b.split('.')[1])).reverse().forEach(version => {
                    availableTypes["FOLIA"].versions.push({
                        "name": version.split('.')[0] + '.' + version.split('.')[1]?.split('-')[0] ?? version.split('.')[1],
                        "versions": versions.filter(v => v.split('.')[1] == (version.split('.')[1]?.split('-')[0] ?? version.split('.')[1]) && !v.includes('-FILLER')).reverse().map(v => {
                            return { name: v }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get folia versions: " + error);
            });
        } else if (type == "PURPUR" && availableTypes["PURPUR"].versions.length <= 0) {
            await invoke("get_all_purpur_game_versions").then((response) => {
                let versions = response.versions.filter(v => !v.includes('-') && parseInt(v.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.split('.')[1] == (vers.split('.')[1]?.split('-')[0] ?? vers.split('.')[1]) && vers.split('.').length == 2).length == 0) {
                        versions.push(v.split('.')[0] + '.' + v.split('.')[1] + '-FILLER');
                    }
                });
                versions.filter(v => v.split('.').length == 2).sort((a, b) => (a.split('.')[1]?.split('-')[0] ?? a.split('.')[1])  - (b.split('.')[1]?.split('-')[0] ?? b.split('.')[1])).reverse().forEach(version => {
                    availableTypes["PURPUR"].versions.push({
                        "name": version.split('.')[0] + '.' + version.split('.')[1]?.split('-')[0] ?? version.split('.')[1],
                        "versions": versions.filter(v => v.split('.')[1] == (version.split('.')[1]?.split('-')[0] ?? version.split('.')[1]) && !v.includes('-FILLER')).reverse().map(v => {
                            return { name: v }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get purpur versions: " + error);
            });
        } else if (type == "SPIGOT" && availableTypes["SPIGOT"].versions.length <= 0) {
            await invoke("get_all_spigot_game_versions").then((response) => {
                let versions = response.filter(v => !v.includes('-') && parseInt(v.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.split('.')[1] == (vers.split('.')[1]?.split('-')[0] ?? vers.split('.')[1]) && vers.split('.').length == 2).length == 0) {
                        versions.push(v.split('.')[0] + '.' + v.split('.')[1] + '-FILLER');
                    }
                });
                versions.filter(v => v.split('.').length == 2).sort((a, b) => (a.split('.')[1]?.split('-')[0] ?? a.split('.')[1])  - (b.split('.')[1]?.split('-')[0] ?? b.split('.')[1])).reverse().forEach(version => {
                    availableTypes["SPIGOT"].versions.push({
                        "name": version.split('.')[0] + '.' + version.split('.')[1]?.split('-')[0] ?? version.split('.')[1],
                        "versions": versions.filter(v => v.split('.')[1] == (version.split('.')[1]?.split('-')[0] ?? version.split('.')[1]) && !v.includes('-FILLER')).reverse().map(v => {
                            return { name: v }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get spigot versions: " + error);
            });
        } else if (type == "BUKKIT" && availableTypes["BUKKIT"].versions.length <= 0) {
            await invoke("get_all_bukkit_game_versions").then((response) => {
                let versions = response.filter(v => !v.includes('-') && parseInt(v.split('.')[1]) >= 7);
                versions.forEach(v => {
                    if (versions.filter(vers => v.split('.')[1] == (vers.split('.')[1]?.split('-')[0] ?? vers.split('.')[1]) && vers.split('.').length == 2).length == 0) {
                        versions.push(v.split('.')[0] + '.' + v.split('.')[1] + '-FILLER');
                    }
                });
                versions.filter(v => v.split('.').length == 2).sort((a, b) => (a.split('.')[1]?.split('-')[0] ?? a.split('.')[1])  - (b.split('.')[1]?.split('-')[0] ?? b.split('.')[1])).reverse().forEach(version => {
                    availableTypes["BUKKIT"].versions.push({
                        "name": version.split('.')[0] + '.' + version.split('.')[1]?.split('-')[0] ?? version.split('.')[1],
                        "versions": versions.filter(v => v.split('.')[1] == (version.split('.')[1]?.split('-')[0] ?? version.split('.')[1]) && !v.includes('-FILLER')).reverse().map(v => {
                            return { name: v }
                        })
                    });
                });
                availableTypes = availableTypes;
            }).catch((error) => {
                addNotification("Failed to get bukkit versions: " + error);
            });
        }
    }

    load()

    function selectVersion(data) {
        version = data.name.replace('-FILLER', '');
        if (type == "VANILLA") {
            availableTypes["VANILLA"].downloadHash = data.hash;
        }
    }
</script>

<div class="tab-wrapper">
    <h1 class="title">{lang.servers.custom.create.version.title}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 class="before-button" on:click={() => showSubVersions == false ? dispatch('back') : showSubVersions = false}>&lt;-</h1>
    {#if majorVersion == null || showSubVersions == false}
        <div class="versions row">
            {#each availableTypes[type].versions as serverVersion}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="version row" class:active={majorVersion == serverVersion.name} on:click={() => {majorVersion = serverVersion.name; showSubVersions = true;}}>
                    <p>{serverVersion.name.replace('-FILLER', '')}</p>
                </div>
            {/each}
        </div>
    {:else}
        <div class="versions row">
            {#each availableTypes[type].versions.find(v => v.name == majorVersion).versions.sort() as serverVersion}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="version row" class:active={version == serverVersion.name} on:click={() => selectVersion(serverVersion)}>
                    <p>{serverVersion.name}</p>
                </div>
            {/each}
        </div>
    {/if}
    {#if version != ""}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="next-button primary-text" on:click={() => dispatch('next')}>-&gt;</h1>
    {/if}
</div>

<style>
    .tab-wrapper {
        display: flex;
        flex-direction: column;
        gap: 1em;
    }

    .title {
        font-size: 30px;
        text-align: center;
        margin-bottom: 1em;
        cursor: default;
    }

    .row {
        display: flex;
        flex-direction: row;
        gap: 1.5em;
    }

    h1 {
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .versions {
        justify-content: center;
        flex-wrap: wrap;
    }

    .version {
            gap: 1em;
        background-color: var(--background-contrast-color);
        width: 100px;
        padding: 20px;
        border-radius: 10px;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        text-wrap: nowrap;
        transition-duration: 200ms;
    }

    .version.active {
        background-color: var(--secondary-color);
        transition-duration: 200ms;
    }
    
    .version:hover {
        transform: scale(1.1);
        transition-duration: 200ms;
    }

    .before-button {
        position: absolute;
        font-size: 30px;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .next-button {
        position: absolute;
        font-size: 30px;
        margin-top: 60%;
        margin-left: 82.5%;
        text-align: center;
        cursor: pointer;
        transition-duration: 200ms;
    }

    .before-button:hover, .next-button:hover {
        transform: scale(1.2);
        transition-duration: 200ms;
    }
</style>