<script>
    import { SkinViewer } from "skinview3d";
    import { invoke } from "@tauri-apps/api/tauri";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import Elytra from "../../images/elytra.webp";

    export let cape;
    export let player;
    export let height = 275;
    export let width = 275;

    let skinViewer;
    let capeData;
    let showElytra = false;

    async function load() {
        await invoke("read_remote_image_file", {
            location: $launcherOptions.experimentalMode ? `https://dl-staging.norisk.gg/capes/prod/${cape}.png` : `https://dl.norisk.gg/capes/prod/${cape}.png`
        }).then((data) => {
            capeData = `data:image/png;base64,${data}`;
        }).catch((err) => {
            console.error(err);
        });

        const canvas = document.createElement("canvas");
        skinViewer = new SkinViewer({
          canvas: canvas,
          width: width - 50,
          height: height,
          skin: "https://crafatar.com/skins/" + player,
          cape: capeData,
          enableControls: false,
        });
        skinViewer.camera.position.set(0, 25, -75);
        skinViewer.zoom = 1.0;
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
    <img src={Elytra} alt={"Elytra toggle"} style={"margin-left: " + (width - 25) + "px;"} class="setting" on:click={() => toggleElytra()} />
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
        z-index: -1;
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
</style>