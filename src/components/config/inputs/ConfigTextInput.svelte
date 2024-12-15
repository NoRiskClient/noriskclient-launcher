
<script>
  export let title;
  export let value; // value of the text field
  export let placeholder = "";
  export let suffix = "";
  export let autofocus = false;
  export let disabled = false;
  export let id = "";
</script>

<div class="input-container">
  <h1>{title}</h1>
  <div class="input-button-wrapper">
    <!-- svelte-ignore a11y-autofocus -->
    <input id={id} placeholder={placeholder} disabled={disabled} autofocus={autofocus} bind:value={value} type="text" class="nes-input" autocomplete="new-password">
    {#if suffix != ""}
      <p class="suffix">{suffix}</p>
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

    input {
      margin-right: 5px;
      border-radius: 5px;
    }

    input:disabled {
      opacity: 0.65;
      text-shadow: none;
    }

    input::placeholder {
      color: var(--font-color-text-shadow);
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

    .nes-input {
        font-size: 10px;
        padding: 6px 8px;
        border: 1px solid #212121;
        background-color: var(--background-contrast-color);
        width: 100%;
        outline: none;
        text-shadow: none;
        transition: background-color 0.3s ease-in-out;
    }

    .nes-input::placeholder {
      color: var(--font-color);
      opacity: 0.65;
    }

    .suffix {
        font-size: 10px;
    }
</style>
