<script>
  import { invoke } from "@tauri-apps/api/tauri";
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { launcherOptions } from "../../stores/optionsStore.js";
  import { getNoRiskToken, deletedCapesCache, cacheDeletedCape } from "../../utils/noriskUtils.js";
  import { addNotification } from "../../stores/notificationStore.js";
  import { translations } from '../../utils/translationUtils.js';
  import { openConfirmPopup } from "../../utils/popupUtils.js";
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  const dispatch = createEventDispatcher();

  export let apiCapes = [];
  export let allowDelete = false;
  let visibleCapes = [];

  $: capes = apiCapes.filter(cape => !($deletedCapesCache ?? []).includes(cape._id));

  // Der aktuelle Index der Seite für die Iteration
  let currentPage = 0;

  // Die Anzahl der Elemente, die du gleichzeitig anzeigen möchtest
  const step = 3;

  // Funktion, um die aktuellen sichtbaren Elemente zu aktualisieren
  function updateVisibleCapes() {
    // braucht man evtl nicht, aber zu faul zum testen
    capes = apiCapes.filter(cape => !($deletedCapesCache ?? []).includes(cape._id))
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

  let ownerName = "";

  async function getNameByUUID(uuid) {
    await invoke("mc_name_by_uuid", {
      uuid: uuid,
    }).then((user) => {
      ownerName = user ?? "Unknown";
    }).catch(error => {
      ownerName = "Unknown";
      addNotification(lang.capes.notification.failedToRequestNameByUUID.replace("{error}", error));
    });
  }

  async function handleEquipCape(hash) {
    if ($defaultUser) {
      await invoke("equip_cape", {
        noriskToken: getNoRiskToken(),
        uuid: $defaultUser.id,
        hash: hash,
      }).then(() => {
        addNotification(lang.capes.notification.equip.success, "INFO");
        dispatch("fetchNoRiskUser");
      }).catch((error) => {
        addNotification(lang.capes.notification.equip.error.replace("{error}", error));
      });
    }
  }

  async function handleDeleteCape(hash) {
    if ($defaultUser) {
      openConfirmPopup({
        title: lang.capes.popup.delete.title,
        content: lang.capes.popup.delete.content,
        confirmButton: lang.capes.popup.delete.button.confirm,
        onConfirm: async () => {
          await invoke("delete_cape", {
            noriskToken: getNoRiskToken(),
            uuid: $defaultUser.id,
            hash: hash,
          }).then(() => {
            addNotification(lang.capes.notification.delete.success, "INFO");
            dispatch("fetchNoRiskUser");
            cacheDeletedCape(hash);
            capes = capes.filter(cape => !$deletedCapesCache.includes(cape._id));
            setTimeout(() => {
              dispatch("refresh");
            }, 3 * 60 * 1000);
            currentPage = 0;
            updateVisibleCapes();
          }).catch((error) => {
            addNotification(lang.capes.notification.delete.error.replace("{error}", error));
          });
        },
      });
    }
  }

  function preventSelection(event) {
    event.preventDefault();
  }

  // Rufe die initialen sichtbaren Elemente auf
  updateVisibleCapes();

  onMount(() => {
    capes = apiCapes.filter(cape => !($deletedCapesCache ?? []).includes(cape._id));
  });
</script>


<div in:fade={{ duration: 400 }} class="cape-wrapper">
  {#if capes !== null}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:selectstart={preventSelection}
        on:mousedown={preventSelection}
        on:click={navigatePrevious} class="button">
      &lt;</h1>

    <div class="cape-slider-wrapper">
      {#if capes.length === 0}
        <p class="fall-back-text">{lang.capes.noCapesHere}</p>
      {/if}

      {#each visibleCapes as cape, index (cape._id)}
        <div class="image-wrapper">
          <h1>{getIndex(cape._id) + 1}.</h1>
          <div
            class="crop"
            on:mouseenter={() => { cape.hovered = true; return getNameByUUID(cape.firstSeen); }}
            on:mouseleave={() => cape.hovered = false}
          >
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="image-click" on:click={() => dispatch("preview", cape._id)}></div>
            <!-- svelte-ignore a11y-img-redundant-alt -->
            <img src={`https://cdn.norisk.gg/capes${$launcherOptions.experimentalMode ? '-staging' : ''}/prod/${cape._id}.png`} alt="Cape Image" class:custom={cape._id.includes("NO_COPY")}>
            {#if allowDelete && cape.firstSeen === $defaultUser.id}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <div on:click={() => handleDeleteCape(cape._id)} class="delete-text">{lang.capes.cape.button.delete}</div>
            {/if}
            {#if !cape._id.includes("NO_COPY") || cape.firstSeen === $defaultUser.id}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <div on:click={() => handleEquipCape(cape._id)} class="equip-text">{lang.capes.cape.button.equip}</div>
            {/if}
          </div>
          {#if cape.hovered}
            <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="info-text">
              {lang.capes.uploadedBy.replace("{name}", ownerName)}
            </div>
            <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="info-text-bottom">
              {lang.capes.usedBy.replace("{count}", cape.uses)}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <h1 on:selectstart={preventSelection}
        on:mousedown={preventSelection}
        on:click={navigateNext}
        class="button">&gt;</h1>
  {/if}
</div>

<style>
    .button {
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
        height: 100%;
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
        font-size: 18px;
        margin-top: 2em;
        cursor: default;
        text-align: center;
        flex-basis: 100%;
    }

    .image-wrapper h1 {
        font-size: 18px;
        cursor: default;
    }

    .crop {
        /* position: relative; */
        width: 80px;
        height: 128px;
        overflow: hidden;
        transform: scale(1.2);
        transition: transform 0.3s;
        box-shadow: 0px 0px 8px 0px rgba(0, 0, 0, 0.75);
    }

    .crop:hover {
        transform: scale(1.5);
    }

    .image-click {
        position: absolute;
        width: 512px;
        height: 256px;
        cursor: pointer;
    }

    .crop img {
        position: relative;
        width: 512px;
        height: 256px;
        left: -8px;
        top: -8px;
    }

    .crop img.custom {
        /* Implement custom fitting for dynamic size here */
    }

    .equip-text {
        font-size: 14px;
        text-shadow: 2px 2px #57cc00;
        cursor: pointer;
        position: absolute;
        bottom: 0.15em;
        left: 50%;
        outline: 2px solid black;
        background: #7cff00;
        transform: translateX(-50%);
        color: #0a7000;
        padding: 4px 3px;
        opacity: 0;
        transition: opacity 0.3s;
    }

    .crop:hover .equip-text {
        opacity: 1;
    }

    .delete-text {
        font-size: 11px;
        text-shadow: none;
        cursor: pointer;
        position: absolute;
        top: 0.15em;
        right: 0px;
        outline: 1.5px solid black;
        background: #460000;
        padding: 2px;
        opacity: 0;
        transition: opacity 0.3s;
    }

    .crop:hover .delete-text {
        opacity: 1;
    }

    .info-text {
        position: absolute;
        bottom: 2em;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        opacity: 0;
        transition: opacity 0.3s;
        font-size: 18px;
        text-shadow: 2px 2px #d0d0d0;
        cursor: default;
    }

    .info-text-bottom {
        bottom: 1.5em;
        left: 50%;
        transform: translateX(-50%);
        position: absolute;
        transition: opacity 0.3s;
        font-size: 11px;
        color: white;
        text-shadow: 1.25px 1.25px #d0d0d0;
        cursor: default;
    }

    /* Einblendung des .info-text */
    .image-wrapper:hover .info-text, .info-text-bottom {
        opacity: 1;
    }
</style>
