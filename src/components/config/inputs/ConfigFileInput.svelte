<script>
  import { open } from '@tauri-apps/api/dialog';
  import { addNotification } from '../../../stores/notificationStore.js';
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

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
        title: lang.fileInput.windowTitle.replace("{file}", requiredFileName.length > 0 ? `(${requiredFileName})` : ''),
        defaultPath: value,
        directory: false,
        filters: [{ name: lang.fileInput.filterName, extensions: extentions }]
      })
      if (typeof result == 'string' && result.length > 0) {
        const splitter = result.includes('\\') ? '\\' : '/';
        if (!requiredFileName.includes("*") && !requiredFileName.includes(result.split(splitter).pop().split('.')[result.split(splitter).pop().split('.').length - 2])) {
          addNotification(lang.fileInput.notification.invalidFileName.replace("{fileNames}", requiredFileName.map(f => `"${f}"`).join(" or ")));
          return;
        }
        value = result
      }
    } catch (error) {
      addNotification(lang.fileInput.notification.failedToSelect.replace("{error}", error));
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
    <input id={id} placeholder={lang.fileInput.placeholder} autofocus={false} bind:value={value} type="text" class="nes-input" disabled>
    <button on:click={selectFolderPath} title={lang.fileInput.tooltip.selectFile}>📂</button>
    {#if defaultValue != undefined}
      <button on:click={resetFilePathToDefault} title={lang.fileInput.tooltip.reset}>🗑️</button>
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
