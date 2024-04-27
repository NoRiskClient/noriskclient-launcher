
<script>
  export let setting;
  export let defaultValue;
  export let tooltip = "";

  function resetSetting() {
      setting = defaultValue;
  }
</script>

<div class="input-container">
    <button on:click={resetSetting} aria-label="Select Folder" title={tooltip}>🔁</button>
</div>

<style>
    .input-container button {
        font-size: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    button {
      outline: none;
      background-color: transparent;
      border: none;
      text-align: center;
    }

    button:hover {
      cursor: pointer;
    }
</style>
