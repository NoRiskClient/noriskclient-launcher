<script>
  export let title;
  export let value;
  export let suffix;
  export let min;
  export let max;
  export let step;
  export let id = "";

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<div class="slider-container">
  <div class="text-wrapper" on:selectstart={preventSelection} on:mousedown={preventSelection}>
    <h1>{title}</h1>
    <h1>{value} {suffix}</h1>
  </div>
  <input id={id} type="range" bind:value={value} min={min} max={max} step={step} class="nes-range" />
</div>

<style>
    .text-wrapper {
        display: flex;
        width: 100%;
        justify-content: space-between;
        cursor: default;
    }

    .slider-container {
        display: flex;
        align-items: start;
        flex-direction: column;
        margin-top: 1em;
        width: 100%;
    }

    .slider-container h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 15px;
        margin-bottom: 0.8em;
    }

    .nes-range {
        -webkit-appearance: none;
        width: 100%;
        height: 8px;
        background: #000000;
        outline: none;
        opacity: 0.7;
        border-radius: 3.5px;
        -webkit-transition: .2s;
        transition: opacity .2s;
    }

    .nes-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        background: var(--secondary-color);
        border-radius: 5px;
        cursor: pointer;
    }

    .nes-range::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: var(--secondary-color);
        cursor: pointer;
    }
</style>
