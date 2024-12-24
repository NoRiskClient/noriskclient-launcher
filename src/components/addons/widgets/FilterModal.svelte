<script>
  import { createEventDispatcher } from "svelte";
  import VirtualList from "../../utils/VirtualList.svelte";
  import ConfigRadioButton from "../../config/inputs/ConfigRadioButton.svelte";
  import { translations } from '../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

  const dispatch = createEventDispatcher();

  export let showModal;
  export let categories = [];
  export let list = [];
  export let activeFilters = {};
  let reload = true;

  // kp, aber funktioniert
  $: if (showModal) {
    loadList();
  }
  
  function loadList() {
    list = [];
    categories.forEach(c => {
      list.push(c.type);
      c.entries.forEach(entry => {
        list.push(entry);
      })
    });
    if (Object.keys(activeFilters).length < 1) {
      resetFilters();
    } else {
      reload = true;
      setTimeout(() => reload = false, 0);
    }
  }
  
  function resetFilters() {
    const reloadSearch = Object.values(activeFilters).filter(c => c.enabled).length > 0;
    activeFilters = {};
    categories.forEach(c => {
      c.entries.forEach(entry => {
        activeFilters[entry.id] = {
          id: entry.id,
          name: entry.name,
          enabled: false
        }
      })
    });
    reload = true;
    setTimeout(() => reload = false, 0);
    if (reloadSearch) dispatch('search');
  }
  
  loadList();

  const hideModal = () => showModal = false;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
{#if showModal}
  <div class="overlay" on:click={hideModal}>
    <div class="dialog">
      <div on:click|stopPropagation class="divider">
        <div>
          <div class="header-wrapper">
            <h1 class="nes-font">{lang.addons.filters.title}</h1>
            <h1 class="nes-font red-text-clickable close-button" on:click={hideModal}>X</h1>
          </div>
          <hr>
          <div class="settings-wrapper">
            {#if !reload}
              <VirtualList height="27.5em" items={list} let:item>
                {#if item?.id == undefined || item?.id == null}
                  <p class="filter-type primary-text" class:first={list.indexOf(item) == 0}>{item}</p>
                {:else}
                  <ConfigRadioButton bind:value={activeFilters[item.id].enabled} text={item.name} reversed={true} spaced={true} on:toggle={() => dispatch('search')} />
                  <div style="height: 7.5px;"></div>
                {/if}
              </VirtualList>
            {/if}
          </div>
        </div>
        <!-- svelte-ignore a11y-autofocus -->
        <div class="clear-data-button-wrapper">
          <p class="red-text" on:click={resetFilters}>{lang.addons.filters.button.resetFilters}</p>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
    .header-wrapper {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 1em;
    }

    .close-button {
        transition: transform 0.3s;
    }

    .close-button:hover {
        transition: transform 0.3s;
        transform: scale(1.2);
        cursor: pointer;
    }

    .settings-wrapper {
        display: flex;
        flex-direction: column;
        margin-top: 1.5em;
        gap: 1em;
        user-select: none;
    }

    .filter-type {
        font-size: 20px;
      margin-top: 30px;
      margin-bottom: 15px;
      user-select: none;
      cursor: default;
    }

    .filter-type.first {
      margin-top: 5px;
    }

    .divider {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        padding: 1em;
    }

    .overlay {
        position: fixed;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.2);
        z-index: 999998;
    }

    .dialog {
        background-color: var(--background-color);
        border: 5px solid black;
        width: 34em;
        height: 40em;
        border-radius: 0.2em;
        padding: 0;
        position: fixed; /* Fixierte Positionierung */
        top: 50%; /* 50% von oben */
        left: 50%; /* 50% von links */
        transform: translate(-50%, -50%); /* Verschiebung um die Hälfte der eigenen Breite und Höhe */
        z-index: 999999;
    }
    .dialog > div {
        padding: 1em;
    }

    .nes-font {
        font-size: 30px;
        user-select: none;
        cursor: default;
    }

    .clear-data-button-wrapper {
        display: flex;
        align-content: center;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        padding: 1em;
        text-shadow: 2px 2px #6e0000;
        user-select: none;
    }

    .clear-data-button-wrapper p {
        color: #ff0000;
        padding: 0.3em;
        cursor: pointer;
        transition: transform 0.3s;
    }

    .clear-data-button-wrapper p:hover {
        transform: scale(1.2);
    }
</style>
