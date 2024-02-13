<script>
  import { afterUpdate, onDestroy, onMount, createEventDispatcher } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import ClientLog from "../log/LogPopup.svelte";

  const dispatch = createEventDispatcher()

  export let progressBarLabel;
  export let progressBarMax;
  export let progressBarProgress;
  export let log;

  $: progress = progressBarProgress / progressBarMax;

  let loadingText = "Loading";
  let dots = 0;
  let animationInterval;
  let isFinished;
  let clientLogShown;

  function startAnimation() {
    animationInterval = setInterval(() => {
      dots = (dots + 1) % 4;
    }, 500);
  }

  function stopAnimation() {
    clearInterval(animationInterval);
  }

  function convertToPercentage(value) {
    return Math.round(value * 100);
  }

  onMount(() => {
    startAnimation();
    return stopAnimation; // Dies wird beim Zerstören der Komponente aufgerufen
  });

  onDestroy(() => {
    stopAnimation(); // Stopp die Animation, wenn die Komponente zerstört wird
    progressBarLabel = null;
  });

  afterUpdate(() => {
    if (progressBarLabel === "Launching...") {
      stopAnimation();
      isFinished = true;
      loadingText = "Starting Game";
    }
  });

  function preventSelection(event) {
    event.preventDefault();
  }

  async function terminateClient() {
    await invoke("terminate");
  }
</script>

{#if !isNaN(progress) && progressBarLabel !== undefined}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>
  {#if clientLogShown}
    <ClientLog messages={log} on:hideClientLog={() => clientLogShown = false} />
  {/if}
  <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
      class="nes-font-big">{convertToPercentage(progress)}%</h1>
  <h1 on:selectstart={preventSelection} on:mousedown={preventSelection}
      class="nes-font-small progress-label-text">{progressBarLabel} </h1>
  {#if isFinished}
    <div class="button-wrapper">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="nes-font-big logs" on:click={() => clientLogShown = true}>LOGS</h1>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="nes-font-big close red-text-clickable" on:click={terminateClient}>CLOSE</h1>
    </div>
  {/if}
{/if}


<style>
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
