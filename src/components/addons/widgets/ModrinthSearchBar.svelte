<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher();

    export let title = undefined; // optional
    export let placeHolder;
    export let searchTerm;

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

<div class="input-container">
    {#if title !== undefined}
        <h1>{title}</h1>
    {/if}
    <div class="input-button-wrapper">
        <!-- svelte-ignore a11y-autofocus -->
        <input on:input={onChange}
               bind:value={searchTerm}
               autofocus={true}
               placeholder={placeHolder}
               type="text"
               class="nes-input">
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
        font-family: 'Press Start 2P', serif;
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
        font-family: 'Press Start 2P', serif;
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
</style>
