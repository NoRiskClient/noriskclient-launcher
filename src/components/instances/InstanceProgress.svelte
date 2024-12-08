<script>
  import { location, params, pop } from "svelte-spa-router";
  import TransitionWrapper from "../../pages/TransitionWrapper.svelte";
  import { afterUpdate, onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { translations } from "../../utils/translationUtils.js";
  import { preventSelection } from "../../utils/svelteUtils.js";
  import {
    clientInstances,
    getClientInstances,
    isClientRunning,
    openMinecraftLogsWindow,
    stopClient,
  } from "../../utils/noriskUtils.js";

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  $: id = $params?.id;
  $: instance = $clientInstances.find(value => {
    return value.id === id;
  });

  $: if (instance) {
    //instance.
    instance.progressUpdates.forEach(value => {
      handleProgressUpdate(value);
    });
    // Führe hier deinen Code aus
  }

  $: progressBarMax = 0;
  $: progressBarProgress = 0;
  $: progressBarLabel = 0;
  $: isFinished = false;

  $: progress = progressBarProgress / progressBarMax;

  onMount(async () => {
    await getClientInstances();

    const progressUnlisten = listen("progress-update", event => {
      let instanceId = event.payload.instanceId;
      if (instanceId !== id) return;
      let progressUpdate = event.payload.data;
      handleProgressUpdate(progressUpdate);
    });

    return () => {
      progressUnlisten.then(() => {
      });
    };
  });

  afterUpdate(() => {
    if (progressBarLabel === lang.startProgress.step.launching) {
      isFinished = true;

      setTimeout(() => {
        if ($location === "/start-progress/" + id) {
          pop();
        }
      }, 30 * 1000);
    }
  });

  function handleProgressUpdate(progressUpdate) {
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
        progressBarLabel = lang.startProgress.step[progressUpdate.value.replace("translation.", "").split("&")[0]]?.replace(`{${progressUpdate.value.split("&")[1]?.split("%")[0]}}`, progressUpdate.value.split("&")[1]?.split("%")[1]) ?? progressUpdate.value;
        break;
      }
    }
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
    {:else}
      <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
          class="nes-font-big">{convertToPercentage(0)}%</h1>
      <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
          class="nes-font-small progress-label-text">{lang.startProgress.step.waiting}</h1>
    {/if}
    {#if isFinished}
      <div class="button-wrapper">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="nes-font-big logs" on:click={() => {openMinecraftLogsWindow(id)}}>{lang.startProgress.button.logs}</h1>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="nes-font-big close red-text-clickable" on:click={() => stopClient(id)}>
          {lang.startProgress.button.close}
        </h1>
      </div>
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
        font-size: 8px;
        margin: 0;
        cursor: default;
    }
</style>
