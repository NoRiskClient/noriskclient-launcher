<script>
  import { listen } from "@tauri-apps/api/event";
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import { afterUpdate, onMount } from "svelte";
  import { preventSelection } from "../utils/svelteUtils.js";
  import { isClientRunning, startProgress, stopClient } from "../utils/noriskUtils.js";
  import { invoke } from "@tauri-apps/api";
  import { addNotification } from "../stores/notificationStore.js";

  $: progressBarMax = $startProgress.progressBarMax;
  $: progressBarProgress = $startProgress.progressBarProgress;
  $: progressBarLabel = $startProgress.progressBarLabel;
  $: isFinished = $isClientRunning;

  $: progress = progressBarProgress / progressBarMax;

  listen("progress-update", event => {
    let progressUpdate = event.payload;

    switch (progressUpdate.type) {
      case "max": {
        startProgress.update(value => {
          return { ...value, progressBarMax: progressUpdate.value };
        });
        break;
      }
      case "progress": {
        startProgress.update(value => {
          return { ...value, progressBarProgress: progressUpdate.value };
        });
        break;
      }
      case "label": {
        startProgress.update(value => {
          return { ...value, progressBarLabel: progressUpdate.value };
        });
        break;
      }
    }
  });

  onMount(() => {
    //Jup hier kann ein bug auftreten und der Progress ist über > 1000% aber jcukt erstmal
    if (isFinished) {
      //progressBarProgress = 100;
      //progressBarMax = 100;
      //progressBarLabel = "Launching...";
    }
  });

  listen("client-error", (e) => {
    //clientLogShown = true;
    alert(e.payload);
    //forceServer = null;
  });

  afterUpdate(() => {
    if (progressBarLabel === "Launching...") {
      isFinished = true;
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
</style>
