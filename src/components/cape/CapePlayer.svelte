<script>
    import { SkinViewer } from "skinview3d";
    import { invoke } from "@tauri-apps/api/tauri";
    import Elytra from "../../images/elytra.webp";

    export let cape;
    export let player;
    export let capeRank;
    export let height = 200;
    export let width = 120;

    let skinViewer;
    let capeData;
    let showElytra = false;

    async function load() {
        await invoke("read_remote_image_file", { location: cape }).then((data) => {
            capeData = `data:image/png;base64,${data}`;
        }).catch((err) => {
            console.error(err);
        });

        const canvas = document.createElement("canvas");
        skinViewer = new SkinViewer({
          canvas: canvas,
          width: width,
          height: height,
          skin: "https://crafatar.com/skins/" + player,
          cape: capeData,
          enableControls: false,
        });
        skinViewer.camera.position.set(-15, 30, -75);
        skinViewer.zoom = 1.0;
        document.getElementById("player").appendChild(canvas);
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
    <div id="player" class="player" />
    {#if capeRank != "CURRENT" && capeRank != null}
        <div class="equip-button" style={"margin-right: " + width / 5 + "px;"}>EQUIP</div>
    {/if}
</div>

<style>
    .capePlayer {
        display: flex-box;
        overflow: hidden;
        margin-bottom: 1em;
    }

    .player {
        position: absolute;
    }

    .setting {
        position: absolute;
        height: 20px;
        margin-top: 0.5em;
        cursor: pointer;
        opacity: 0%;
        align-self: flex-start;
        z-index: 10;
        transition-duration: 200ms;
    }

    .capePlayer:hover .setting {
        opacity: 100%;
        transition-duration: 200ms;
    }

    .equip-button {
        display: flex;
        font-family: 'Press Start 2P', serif;
        height: 30px;
        width: 80%;
        z-index: 10;
        text-shadow: none;
        text-align: center;
        justify-content: center;
        margin-left: 10%;
        margin-top: 110%;
        padding: 7px;
        color: #0a7000;
        cursor: pointer;
        background-color: #7cff00;
        border: 3px solid black;
        transform: translateY(30px);
        transition-duration: 200ms;
    }

    .capePlayer:hover .equip-button {
        transform: translateY(0px);
    }
</style>