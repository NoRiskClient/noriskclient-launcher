<script>
	import { defaultUser } from './../../stores/credentialsStore.js';
    import { SkinViewer } from "skinview3d";
    import { invoke } from "@tauri-apps/api/tauri";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import { addNotification } from "../../stores/notificationStore.js";
    import Elytra from "../../images/elytra.webp";
    import { translations } from '../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    export let cape;
    export let data;
    export let height = 275;
    export let width = 275;

    let skinViewer;
    let capeData;
    let skinData;
    let showElytra = false;

    async function load() {
        // Load current skin
        await invoke("get_player_skins", {
            uuid: $defaultUser.id
        }).then(async (profileTextures) => {
            let profileTexture = profileTextures[0];
            if (profileTexture) {
                profileTexture = JSON.parse(atob(profileTexture));
            }
            skinData = profileTexture != null ? profileTexture.textures.SKIN.url : "";
        }).catch((error) => {
            addNotification(lang.capes.notification.failedToLoadPlayerSkin.replace("{error}", error));
        });

        // Load current cape
        if (!data) {
            await invoke("read_remote_image_file", {
                location: `https://cdn.norisk.gg/capes${$launcherOptions.experimentalMode ? '-staging' : ''}/prod/${cape}.png`
            }).then((data) => {
                capeData = `data:image/png;base64,${data}`;
            }).catch((error) => {
                addNotification(lang.capes.notification.failedToLoadCape.replace("{error}", error));
            });
        } else {
            capeData = data;
        }

        const canvas = document.createElement("canvas");
        skinViewer = new SkinViewer({
          canvas: canvas,
          width: width - 50,
          height: height,
          skin: skinData,
          cape: capeData,
        });
        skinViewer.camera.position.set(0, 25, -75);
        skinViewer.zoom = 1.0;
        skinViewer.controls.enableZoom = false;
        document.getElementById(`player-${cape}`).appendChild(canvas);
    };

    function toggleElytra() {
        showElytra = !showElytra;
        skinViewer.loadCape(capeData, { backEquipment: showElytra ? "elytra" : "cape" });
    }

    load();
</script>

<div class="capePlayer" style={"height: " + height + "px; width: " + width + "px;"}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="elytra-click" style={"margin-left: " + (width - 25) + "px;"} on:click={() => toggleElytra()}></div>
    <img src={Elytra} alt={"Elytra toggle"} style={"margin-left: " + (width - 25) + "px;"} class="setting" />
    <div id={"player-" + cape} class="player" style={"height: " + height + "px; width: " + width + "px;"} />
</div>

<style>
    .capePlayer {
        justify-content: center;
        align-items: center;
        overflow: hidden;
        margin-bottom: 1em;
    }

    .player {
        position: absolute;
        margin-left: 30px;
        display: flex;
        justify-self: center;
        align-self: center;
        z-index: 5;
    }

    .setting {
        position: absolute;
        display: flex;
        height: 25px;
        width: 25px;
        justify-self: flex-start;
        align-self: flex-start;
        margin-top: 0.5em;
        cursor: pointer;
        opacity: 100%;
        z-index: 10;
        transition-duration: 200ms;
    }

    .capePlayer:hover .setting {
        opacity: 100%;
        transition-duration: 200ms;
    }

    .elytra-click {
        position: absolute;
        display: flex;
        height: 25px;
        width: 25px;
        justify-self: flex-start;
        align-self: flex-start;
        margin-top: 0.5em;
        cursor: pointer;
        z-index: 20;
    }
</style>