<script>
  import { push } from "svelte-spa-router";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 on:click={() => push("/start-progress")}>[GAME]</h1>

<style>
    h1 {
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    h1:hover {
        transform: scale(1.2);
    }
</style>
