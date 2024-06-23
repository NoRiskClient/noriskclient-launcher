<!-- TransitionWrapper.svelte -->
<script>
  import { scale } from "svelte/transition";
  import { onMount } from "svelte";
  import { quintOut } from "svelte/easing";

  let visible = false;

  onMount(() => {
    setTimeout(() => {
      visible = true;
    }, 300);
  });
</script>

{#if visible}
  <div class="box" transition:scale={{ x: 15, duration: 300, easing: quintOut }}>
    <slot />
  </div>
{/if}

<style>
  .box {
      width: 100%;
      height: 100%;
      border: 1px solid green;
  }
</style>
