<script>
  export let title;
  export let placeHolder;
</script>

<div class="input-container">
  <h1>{title}</h1>
  <div class="input-button-wrapper">
    <!-- svelte-ignore a11y-autofocus -->
    <input disabled autofocus={false} placeholder={placeHolder} type="text" class="nes-input">
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

    .nes-input {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        padding: 6px 8px;
        border: 1px solid #212121;
        background-color: var(--background-contrast-color);
        width: 100%;
        outline: none;
        transition: background-color 0.3s ease-in-out;
    }

    .nes-input::placeholder {
      color: var(--font-color);
    }
</style>
