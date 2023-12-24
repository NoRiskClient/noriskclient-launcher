<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  export let options;
  export let capes = [];
  let visibleCapes = [];

  // Der aktuelle Index der Seite für die Iteration
  let currentPage = 0;

  // Die Anzahl der Elemente, die du gleichzeitig anzeigen möchtest
  const step = 3;

  // Funktion, um die aktuellen sichtbaren Elemente zu aktualisieren
  function updateVisibleCapes() {
    if (capes === null) return;
    visibleCapes = [];

    const numVisibleCapes = Math.min(step, capes.length);

    for (let i = 0; i < numVisibleCapes; i++) {
      const index = (currentPage * step + i);
      if (index >= capes.length) break;
      visibleCapes.push(capes[index]);
    }
  }

  function navigateNext() {
    currentPage = Math.floor((currentPage + 1) % (capes.length / step));
    updateVisibleCapes();
  }

  function navigatePrevious() {
    currentPage = (currentPage - 1 + Math.ceil(capes.length / step)) % Math.ceil(capes.length / step);
    updateVisibleCapes();
  }

  function getIndex(hash) {
    return capes.findIndex(value => value._id === hash);
  }

  let responseData = "";

  async function getNameByUUID(uuid) {
    console.debug("UUID", uuid);
    await invoke("mc_name_by_uuid", {
      uuid: uuid,
    }).then((user) => {
      responseData = user ?? "Unknown";
    }).catch(e => {
      responseData = "Unknown";
    });
  }

  async function handleEquipCape(hash) {
    console.debug("CLICKED", hash);
    let account = options.accounts.find(obj => obj.uuid === options.currentUuid);
    if (account !== null) {
      await invoke("equip_cape", {
        noriskToken: account.noriskToken,
        hash: hash,
      }).then(() => {
        dispatch("fetchNoRiskUser");
      }).catch((error) => {
        console.error(error);
      });
    }
  }

  function preventSelection(event) {
    event.preventDefault();
  }

  // Rufe die initialen sichtbaren Elemente auf
  updateVisibleCapes();
</script>


<div in:fade={{ duration: 400 }} class="cape-wrapper">
  {#if capes !== null}
    <h1 on:selectstart={preventSelection}
        on:mousedown={preventSelection}
        on:click={navigatePrevious} class="button">
      &lt;</h1>

    <div class="cape-slider-wrapper">
      {#if capes.length === 0}
        <p class="fall-back-text">No capes here D:</p>
      {/if}

      {#each visibleCapes as cape, index (cape._id)}
        <div class="image-wrapper">
          <h1>{getIndex(cape._id) + 1}.</h1>
          <div
            class="crop"
            on:mouseenter={() =>{
                            cape.hovered = true
                            return getNameByUUID(cape.firstSeen); }}
            on:mouseleave={() => cape.hovered = false}
          >
            {#if options.experimentalMode}
              <img src={`https://dl-staging.norisk.gg/capes/prod/${cape._id}.png`} alt="Cape Image">
            {:else}
              <img src={`https://dl.norisk.gg/capes/prod/${cape._id}.png`} alt="Cape Image">
            {/if}
            <div on:click={handleEquipCape(cape._id)} class="equip-text">
              EQUIP
            </div>
          </div>
          {#if cape.hovered}
            <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="info-text">
              by {responseData}
            </div>
            <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="info-text-bottom">
              {cape.uses} Uses
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <h1 on:selectstart={preventSelection}
        on:mousedown={preventSelection}
        on:click={navigateNext}
        class="button">&gt;</h1>
  {/if}
</div>

<style>
    .button {
        font-family: 'Press Start 2P', serif;
        font-size: 30px;
        margin-top: 1.5em;
        cursor: pointer;
    }

    .button:hover {
        color: #b4b4b4;
    }

    .cape-slider-wrapper {
        display: flex;
        flex-direction: row;
        gap: 5rem;
        flex-grow: 1;
        justify-content: center;
    }

    .cape-wrapper {
        display: flex;
        gap: 5em;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        width: 100vw;
        padding: 2.25rem;
    }

    .image-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        align-content: space-between;
        gap: 30px;
    }

    .fall-back-text {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-top: 2em;
        cursor: default;
        text-align: center;
        flex-basis: 100%;
    }

    .image-wrapper h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        cursor: default;
    }

    .crop {
        position: relative;
        width: 96px;
        height: 136px;
        overflow: hidden;
        transform: scale(1.2);
        transition: transform 0.3s;
        box-shadow: 0px 0px 8px 0px rgba(0, 0, 0, 0.75);
    }

    .crop:hover {
        transform: scale(1.5);
    }

    .crop img {
        width: 512px;
        height: 256px;
    }

    .equip-text {
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        text-shadow: 2px 2px #57cc00;
        cursor: pointer;
        position: absolute;
        bottom: 0.3em;
        left: 50%;
        outline: 2px solid black;
        background: #7cff00;
        transform: translateX(-50%);
        color: #0a7000;
        padding: 4px 8px;
        opacity: 0;
        transition: opacity 0.3s;
    }

    .crop:hover .equip-text {
        opacity: 1;
    }

    .info-text {
        position: absolute;
        bottom: 7em;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        opacity: 0;
        transition: opacity 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        text-shadow: 2px 2px #d0d0d0;
        cursor: default;
    }

    .info-text-bottom {
        bottom: 11em;
        left: 50%;
        transform: translateX(-50%);
        position: absolute;
        transition: opacity 0.3s;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #7e7e7e;
        text-shadow: 2px 2px #d0d0d0;
        cursor: default;
    }

    /* Einblendung des .info-text */
    .image-wrapper:hover .info-text, .info-text-bottom {
        opacity: 1;
    }
</style>
