<script>
	import { pop, location } from 'svelte-spa-router';
  import { listen } from "@tauri-apps/api/event";
  import { afterUpdate, onMount } from "svelte";
  import { preventSelection } from "../../utils/svelteUtils.js";
  import { isClientRunning, startProgress, stopClient, openMinecraftLogsWindow } from "../../utils/noriskUtils.js";

  $: progressBarMax = $startProgress.progressBarMax;
  $: progressBarProgress = $startProgress.progressBarProgress;
  $: progressBarLabel = $startProgress.progressBarLabel;
  $: isFinished = $isClientRunning[0];

  $: progress = progressBarProgress / progressBarMax;

  onMount(() => {
    const progressUnlisten = listen("progress-update", event => {
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

    return () => {
      progressUnlisten.then(() => {
      });
    };
  });

  afterUpdate(() => {
    if (progressBarLabel === "Launching...") {
      isFinished = true;

      setTimeout(() => {
        if ($location == "/start-progress") {
          pop();
        }
      }, 30 * 1000);
    }
  });

  onMount(() => {
    if ($isClientRunning[0]) {
      progressBarLabel = "Running...";
      progress = 1;
    }
  });


  function convertToPercentage(value) {
    return Math.round(value * 100);
  }
</script>

<div class="start-progress-wrapper">
  {#if !isNaN(progress) && progressBarLabel !== undefined}
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
        class="nes-font-big">{convertToPercentage(progress)}%</h1>
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
        class="nes-font-small progress-label-text">{progressBarLabel} </h1>
  {:else}
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
        class="nes-font-big">{convertToPercentage(0)}%</h1>
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
        class="nes-font-small progress-label-text">Waiting...</h1>
  {/if}
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
</div>

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
