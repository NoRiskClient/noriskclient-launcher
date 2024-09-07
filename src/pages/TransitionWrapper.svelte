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
  <div class="box" id="transition-wrapper" transition:scale={{  duration: 300, easing: quintOut }}>
    <slot />
  </div>
{/if}

<style>
    .box {
        width: 720px;
        height: 100%;
        overflow: auto;
        overflow-x: hidden;
        scrollbar-gutter: stable both-edges;
    }
</style>
