<script>
    import { SkinViewer } from "skinview3d";
    import { invoke } from "@tauri-apps/api/tauri";
    import { launcherOptions } from "../../stores/optionsStore.js";
    import Elytra from "../../images/elytra.webp";

    export let cape;
    export let player;
    export let capeRank;
    export let isEquippable;
    export let uses;
    export let handleEquipCape = (_) => {};
    export let height = 200;
    export let width = 200;

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
        skinViewer.camera.position.set(-15, 30, -75);
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
    {#if isEquippable}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="equip-button" style={"margin-right: " + width / 5 + "px;"} on:click={() => handleEquipCape(cape)}>EQUIP</div>
    {/if}
    {#if capeRank == 0}
        <h1 class="placement-text first" style={"margin-bottom: " + (height + 65) + "px;"}>#1</h1>
    {:else if capeRank == 1}
        <h1 class="placement-text second" style={"margin-bottom: " + (height + 65) + "px;"}>#2</h1>
    {:else if capeRank == 2}
        <h1 class="placement-text third" style={"margin-bottom: " + (height + 65) + "px;"}>#3</h1>
    {/if}
</div>

<style>
    .capePlayer {
        justify-content: center;
        align-items: center;
        overflow: scroll;
        margin-bottom: 1em;
        background-color: aqua;
    }

    .player {
        display: flex;
    }

    .setting {
        display: flex;
        height: 20px;
        width: 20px;
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

    .equip-button {
        font-family: 'Press Start 2P', serif;
        height: 30px;
        width: 80%;
        z-index: 10;
        text-shadow: none;
        text-align: center;
        justify-content: center;
        margin-left: 10%;
        margin-top: -20%;
        padding: 7px;
        color: #0a7000;
        cursor: pointer;
        background-color: #7cff00;
        border: 3px solid black;
        opacity: 100%;
        transform: translateY(70px);
        transition-duration: 200ms;
    }

    .capePlayer:hover .equip-button {
        transform: translateY(-30px);
        opacity: 100%;
    }

    .placement-text {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        text-align: center;
        margin-top: 10%;
    }

    .first {
        color: gold;
        text-shadow: 2px 2px goldenrod;
    }

    .second {
        color: silver;
        text-shadow: 2px 2px #9a9a9a;
    }

    .third {
        color: #cd7f32;
        text-shadow: 2px 2px #8b4513;
    }
</style>