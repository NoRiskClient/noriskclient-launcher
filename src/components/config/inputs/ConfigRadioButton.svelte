<script>
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();

  export let value;
  export let text;
  export let isExclusive = false;
  export let isExclusiveLabel = "";
  export let reversed = false;
  export let spaced = false;
  export let id = "";

  function preventSelection(event) {
    event.preventDefault();
  }
</script>

<div class="wrapper" class:spaced={spaced}>
  {#if reversed}
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection} class="nes-font">{text}</h1>
    {#if isExclusive}
      <h1 class="nes-font exclusive" title="You can see this because you have special permissions.">({isExclusiveLabel})</h1>
    {/if}
  {/if}
  <label class="nes-switch">
    <input id={id} type="checkbox" bind:checked={value} on:change={(e) => dispatch("toggle")}>
    <span class="nes-slider"></span>
  </label>
  {#if !reversed}
    <h1 on:selectstart={preventSelection} on:mousedown={preventSelection} class="nes-font">{text}</h1>
    {#if isExclusive}
      <h1 class="nes-font exclusive" title="You can see this because you have special permissions.">({isExclusiveLabel})</h1>
    {/if}
  {/if}
</div>

<style>
    .wrapper {
        display: flex;
        align-items: center;
        gap: 1em;
    }

    .exclusive {
      font-size: 12.5px;
      color: var(--dev-font-color);
      text-shadow: 1.25px 1.25px var(--dev-font-color-text-shadow);
    }

    .spaced {
      justify-content: space-between;
      padding-right: 10px;
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
        border-radius: 5px;
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
