<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import CapePlayer from "./CapePlayer.svelte";
  import { getNoRiskToken } from "../../utils/noriskUtils.js";

  const dispatch = createEventDispatcher();

  export let capes = [];
  export let isOwned;
  let visibleCapes = [];

  // Der aktuelle Index der Seite für die Iteration
  let currentPage = 0;

  // Die Anzahl der Elemente, die du gleichzeitig anzeigen möchtest
  const step = 3;

  // Funktion, um die aktuellen sichtbaren Elemente zu aktualisieren
  function updateVisibleCapes() {
    if (capes === null) return;
    visibleCapes = [];
    let capeCount = 0;

    for (let i = 0; i < capes.length; i++) {
      if (capeCount >= capes.length) break;
      if (!visibleCapes[currentPage]) visibleCapes[currentPage] = [];
      visibleCapes[currentPage].push(capes[capeCount]);
      if (visibleCapes[currentPage].length >= step) {
        currentPage++;
      }
      capeCount++;
    }

    console.log(visibleCapes);
  }

  async function handleEquipCape(hash) {
    if ($defaultUser) {
      await invoke("equip_cape", {
        noriskToken: getNoRiskToken(),
        uuid: $defaultUser.id,
        hash: hash,
      }).then(() => {
        dispatch("fetchNoRiskUser");
      }).catch((error) => {
        console.error(error);
      });
    }
  }

  // Rufe die initialen sichtbaren Elemente auf
  updateVisibleCapes();
</script>


<div in:fade={{ duration: 400 }} class="cape-wrapper">
  {#if capes.length === 0}
    <p class="fall-back-text">No capes here D:</p>
  {/if}

  {#each visibleCapes as rowCapes}
    <div class="capeRow" class:firstRow={visibleCapes[0] == rowCapes}>
      {#each rowCapes as cape, index (cape._id)}
        <CapePlayer
          cape={cape._id}
          player={cape.firstSeen}
          capeRank={!isOwned && visibleCapes[0].includes(cape) ? index : null}
          isEquippable={true}
          uses={cape.uses}
          handleEquipCape={handleEquipCape}
        />
        <!-- <h1>hi</h1> -->
      {/each}
    </div>
  {/each}
</div>

<style>
    .cape-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow-x: hidden;
        flex-direction: column;
        width: 100vw;
        height: 80vh;
        padding: 2.25rem;
        background-color: gold;
    }

    .capeRow {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding-left: 10em;
        padding-right: 10em;
        gap: 1em;
        width: 100vw;
        background-color: purple;
    }

    .fall-back-text {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin-top: 2em;
        cursor: default;
        text-align: center;
        flex-basis: 100%;
    }
</style>
