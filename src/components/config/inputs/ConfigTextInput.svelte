
<script>
  import { open } from '@tauri-apps/api/dialog';

  export let title;
  export let placeHolder;
  export let fieldId;

  async function selectFolderPath() {
    try {
      const input = document.getElementById(fieldId)
      const result = await open({
        defaultPath: input.value != "" && input.value != placeHolder ?
                  input.value : placeHolder == 'Internal' ?
                  '' : placeHolder,
        directory: true,
      })
      if (result) {
        input.value = result
      }
    } catch (e) {
      alert("Failed to select folder using dialog")
    }
  }
</script>

<div class="input-container">
  <h1>{title}</h1>
  <div class="input-button-wrapper">
    <!-- svelte-ignore a11y-autofocus -->
    <input autofocus={false} id={fieldId} value={placeHolder} type="text" class="nes-input" disabled>
    <button on:click={selectFolderPath}>📂</button>
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
    }

    button {
      outline: none;
      background-color: transparent;
      border: none;
      text-align: center;
      padding: 3.5px;
    }

    button:hover {
      cursor: pointer;
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
