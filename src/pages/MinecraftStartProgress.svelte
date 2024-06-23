<script>
  import { listen } from "@tauri-apps/api/event";
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import { afterUpdate } from "svelte";
  import { preventSelection } from "../utils/svelteUtils.js";
  import { stopClient } from "../utils/noriskUtils.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";

  let log = [];
  let progressBarMax = 0;
  let progressBarProgress = 0;
  let progressBarLabel = "";
  let loadingText = "Loading";
  let isFinished = false;

  $: progress = progressBarProgress / progressBarMax;

  listen("progress-update", event => {
    let progressUpdate = event.payload;

    switch (progressUpdate.type) {
      case "max": {
        progressBarMax = progressUpdate.value;
        break;
      }
      case "progress": {
        progressBarProgress = progressUpdate.value;
        break;
      }
      case "label": {
        progressBarLabel = progressUpdate.value;
        break;
      }
    }
  });

  afterUpdate(() => {
    if (progressBarLabel === "Launching...") {
      isFinished = true;
      loadingText = "Starting Game";
    }
  });

  async function openMinecraftLogsWindow() {
    await invoke("open_minecraft_logs_window").catch(reason => {
      addNotification(reason);
    });
  }

  function convertToPercentage(value) {
    return Math.round(value * 100);
  }
</script>
<TransitionWrapper>
  <div class="start-progress-wrapper">
    {#if !isNaN(progress) && progressBarLabel !== undefined}
      {#if false}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>
      {/if}
      {#if false}
        <ClientLog messages={log} on:hideClientLog={() => clientLogShown = false} />
      {/if}
      <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
          class="nes-font-big">{convertToPercentage(progress)}%</h1>
      <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
          class="nes-font-small progress-label-text">{progressBarLabel} </h1>
      {#if isFinished}
        <div class="button-wrapper">
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <h1 class="nes-font-big logs" on:click={openMinecraftLogsWindow}>LOGS</h1>
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <h1 class="nes-font-big close red-text-clickable" on:click={stopClient}>
            CLOSE
          </h1>
        </div>
      {/if}
    {/if}
  </div>
</TransitionWrapper>

<style>
    .start-progress-wrapper {
        border: 5px solid green;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-content: center;
        align-items: center;
        gap: 1em;
    }

    .button-wrapper {
        display: flex;
        position: absolute;
        margin-top: 20em;
        gap: 5em;
    }

    .nes-font-big {
        font-family: 'Press Start 2P', serif;
        font-size: 34px;
        margin: 0;
    }

    .logs {
        transition: transform 0.3s;
    }

    .logs:hover {
        cursor: pointer;
        transform: scale(1.5);
    }

    .close {
        transition: transform 0.3s;
    }

    .close:hover {
        transform: scale(1.5);
    }

    .nes-font-small {
        font-family: 'Press Start 2P', serif;
        font-size: 8px;
        margin: 0;
        cursor: default;
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
