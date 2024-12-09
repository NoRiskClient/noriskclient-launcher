
<script>
  import { open } from '@tauri-apps/api/dialog';
  import { addNotification } from '../../../stores/notificationStore.js';
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  export let title;
  export let value;
  export let id = "";

  // Try to get user-desired folder path via system dialog
  async function selectFolderPath() {
    try {
      const result = await open({
        defaultPath: value,
        directory: true,
      })
      if (result) {
        value = result
      }
    } catch (error) {
      addNotification(lang.folderInput.notification.failedToSelect.replace("{error}", error));
    }
  }
</script>

<div class="input-container">
  <h1>{title}</h1>
  <div class="input-button-wrapper">
    <!-- svelte-ignore a11y-autofocus -->
    <input id={id} placeholder={lang.folderInput.placeholder} autofocus={false} bind:value={value} type="text" class="nes-input" disabled>
    <button on:click={selectFolderPath} title={lang.folderInput.selectFolderTooltip}>📂</button>
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
        font-size: 18px;
        margin-bottom: 0.8em;
        cursor: default;
    }

    .nes-input {
        font-size: 10px;
        padding: 6px 8px;
        border: 1px solid #212121;
        color: var(--font-color-disabled);
        text-shadow: 1.25px 1.25px var(--font-color-text-shadow);
        background-color: var(--background-contrast-color);
        width: 100%;
        outline: none;
        transition: background-color 0.3s ease-in-out;
    }

    .nes-input::target-text {
      color: var(--font-color);
      opacity: 0.65;
    }

    .nes-input::placeholder {
      color: var(--font-color);
      opacity: 0.65;
    }
</style>
