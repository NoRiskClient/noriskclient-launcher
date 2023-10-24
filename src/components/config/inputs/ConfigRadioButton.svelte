<script>
  export let value;
  export let text;
  export let reversed = false;

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<div class="wrapper">
    {#if reversed}
        <h1 on:selectstart={preventSelection}
            on:mousedown={preventSelection} class="nes-font">{text}</h1>
    {/if}
    <label class="nes-switch">
        <input type="checkbox" bind:checked={value}>
        <span class="nes-slider"></span>
    </label>
    {#if !reversed}
        <h1 on:selectstart={preventSelection}
            on:mousedown={preventSelection} class="nes-font">{text}</h1>
    {/if}
</div>

<style>
    .wrapper {
        display: flex;
        align-items: center;
        gap: 1em;
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        font-size: 14px;
        cursor: default;
    }

    .nes-switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 24px;
    }

    .nes-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--background-contrast-color);
        border-radius: 0.2em;
        -webkit-transition: .4s;
        transition: .4s;
    }

    .nes-slider:before {
        position: absolute;
        content: "";
        height: 20px;
        width: 20px;
        left: 2px;
        bottom: 2px;
        background-color: #ffffff;
        border-radius: 50%;
        box-shadow: 0px 2px 5px var(--font-color-text-shadow);
        -webkit-transition: .4s;
        transition: .4s;
    }

    input:checked + .nes-slider {
        background: var(--secondary-color);
        box-shadow: 0 0 1px var(--secondary-color);
    }

    input:checked + .nes-slider:before {
        -webkit-transform: translateX(16px);
        -ms-transform: translateX(16px);
        transform: translateX(16px);
    }
</style>
