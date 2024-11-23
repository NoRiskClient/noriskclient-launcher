<script>
  import { push } from "svelte-spa-router";
  import { clientInstances, getClientInstances } from "../../utils/noriskUtils.js";
  import { onMount } from "svelte";

  //let instances = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  //let instances = [0, 1, 2];
  //let instances = [0, 1, 2, 3, 4];
  //let instances = [0];
  $: instances = $clientInstances;

  onMount(async () => {
    await getClientInstances();
  });

  function getName(instance) {
    const filtered = instances.filter(value => value.branch === instance.branch);
    const index = filtered.indexOf(instance);
    return instance.branch + ((index > 0) ? ` (${index + 1})` : "");
  }

  // Berechnung der Button-Größe basierend auf der Anzahl der Instanzen
  $: buttonSize = ((1 / instances.length) * instances.length);  // Maximal 10 Instanzen, Button-Größe wird kleiner
</script>

<div class="instance-wrapper">
  {#each instances as instance, index}
    <h1 class="instance-button" on:click={() => push("/start-progress/"+instance.id)}
        style="font-size: {buttonSize}em;">
      [{getName(instance)}]
    </h1>
  {/each}
</div>

<style>
    .instance-wrapper {
        display: flex;
        flex-wrap: wrap;
        gap: 1em;
        justify-content: center;
    }

    .instance-button {
        transition: transform 0.3s, font-size 0.3s;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .instance-button:hover {
        transform: scale(1.2);
    }
</style>
