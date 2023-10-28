<script>
    import {createEventDispatcher} from "svelte";

    const dispatch = createEventDispatcher();

    export let title = undefined; // optional
    export let placeHolder;
    export let searchTerm;

    const onKeyPress = e => {
        if (e.charCode === 13) dispatch("search");
    };
</script>

<div class="input-container">
    {#if title !== undefined}
        <h1>{title}</h1>
    {/if}
    <div class="input-button-wrapper">
        <input on:keypress={onKeyPress}
               bind:value={searchTerm}
               autofocus={false}
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
