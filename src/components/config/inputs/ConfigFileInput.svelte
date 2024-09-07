
<script>
  import { open } from '@tauri-apps/api/dialog';
  import { addNotification } from '../../../stores/notificationStore.js';

  export let title;
  export let value;
  export let extentions = ['*'];
  export let requiredFileName = ["*"];
  export let defaultValue = undefined;
  export let id = "";

  // Try to get user-desired folder path via system dialog
  async function selectFolderPath() {
    try {
      const result = await open({
        title: `Select File ${requiredFileName.length > 0 ? `(${requiredFileName})` : ''}`,
        defaultPath: value,
        directory: false,
        filters: [{ name: 'Extentions Filter', extensions: extentions }]
      })
      if (typeof result == 'string' && result.length > 0) {
        const splitter = result.includes('\\') ? '\\' : '/';
        if (!requiredFileName.includes("*") && !requiredFileName.includes(result.split(splitter).pop().split('.')[result.split(splitter).pop().split('.').length - 2])) {
          addNotification(`Please select a file with the name ${requiredFileName.map(f => `"${f}"`).join(" or ")}, depending on your OS!`);
          return;
        }
        value = result
      }
    } catch (error) {
      addNotification("Failed to select file using dialog: " + error);
    }
  }

  function resetFilePathToDefault() {
    value = defaultValue;
  }
</script>

<div class="input-container">
  <h1>{title}</h1>
  <div class="input-button-wrapper">
    <!-- svelte-ignore a11y-autofocus -->
    <input id={id} placeholder="Detect Automatically" autofocus={false} bind:value={value} type="text" class="nes-input" disabled>
    <button on:click={selectFolderPath} aria-label="Select File" title="Select File">📂</button>
    {#if defaultValue != undefined}
      <button on:click={resetFilePathToDefault} aria-label="Reset" title="Reset">🗑️</button>
    {/if}
  </div>
</div>

<style>
    .input-container {
      width: 100%;
    }

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
      opacity: 0.65;
    }
</style>
