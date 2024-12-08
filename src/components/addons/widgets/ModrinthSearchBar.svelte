<script>
    import {createEventDispatcher} from "svelte";
    import FilterModal from "./FilterModal.svelte";

    const dispatch = createEventDispatcher();

    export let title = undefined; // optional
    export let placeHolder;
    export let searchTerm;
    export let filterCategories = [];
    export let filters = {};
    export let options = null;

    let showFilterModal = false;

    let last_change = new Date();

    const onChange = () => {
        const now = new Date();
        last_change = now;
        setTimeout(() => {
            if (last_change === now) {
                dispatch('search');
            }
        }, 200);
    };
</script>

<FilterModal categories={filterCategories} bind:activeFilters={filters} bind:showModal={showFilterModal} on:search={onChange} />
<div class="input-container">
    {#if title !== undefined}
        <h1>{title}</h1>
    {/if}
    <div class="input-button-wrapper" class:hasFilter={filterCategories.length > 0}>
        <!-- svelte-ignore a11y-autofocus -->
        <input on:input={onChange}
               bind:value={searchTerm}
               autofocus={true}
               placeholder={placeHolder}
               type="text"
               class="nes-input">
        {#if filterCategories.length > 0}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
          <svg class="filter-button" on:click={() => showFilterModal = true} style={`fill: ${Object.values(filters).filter(filter => filter.enabled).length > 0 ? 'var(--primary-color)' : options?.theme == "DARK" ? '#ffffff' : '#00000'};`} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px">
            <path d="M0 0h24v24H0V0z" fill="none" />
            <path
              d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
        {/if}
    </div>
</div>

<style>
    .input-button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: row;
        align-items: center;
    }
    
    .input-container {
        display: flex;
        flex-direction: column;
        align-items: start;
    }
    
    .input-container h1 {
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }
    
    .input-container input {
        border-radius: 5px;
    }

    .input-container input::placeholder {
        opacity: 75%;
    }

    .nes-input {
        font-size: 15px;
        padding: 6px 8px;
        line-height: 1em;
        border: 3px solid #212121;
        background-color: var(--background-contrast-color);
        width: 100%;
        outline: none;
        transition: background-color 0.3s ease-in-out;
    }

    .nes-input::placeholder {
      color: var(--font-color);
    }

    .filter-button {
        cursor: pointer;
        margin-left: 20px;
        margin-right: 15px;
        transform: scale(1.2);
        transition-duration: 250ms;
    }

    .filter-button:hover {
        transform: scale(1.5);
    }
</style>
