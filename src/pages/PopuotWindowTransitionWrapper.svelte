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

<!-- Hii die Klasse exisiert weil ich einfach zu scheiße zum coden bin und einfach
 besser in der schule hätte AUFPASSEN SOLLEN
 auf jeden fall wir ich hier custom .box css styling und wusste nicht wie ich das sonst mache gruß <3-->

{#if visible}
  <div class="box" transition:scale={{  duration: 300, easing: quintOut }}>
    <slot />
  </div>
{/if}

<style>
    .box {
        width: 100%;
        height: 100%;
        overflow: auto;
        overflow-x: hidden;
        scrollbar-gutter: stable both-edges;
    }
</style>
