<script>
  import { preventSelection } from "../../utils/svelteUtils.js";
  import { push } from "svelte-spa-router";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="addons-wrapper" on:selectstart={preventSelection}>
  <h1 class="title">Addons</h1>
  <div class="card" style="margin-top: 60px;" on:click={() => push('/addons/mods')}>
    <h2>📦 Mods</h2>
    <p>&gt;</p>
  </div>
  <div class="card" on:click={() => push('/addons/resourcepacks')}>
    <h2>🎨 Resource Packs</h2>
    <p>&gt;</p>
  </div>
  <div class="card" on:click={() => push('/addons/shaders')}>
    <h2>🔮 Shaders</h2>
    <p>&gt;</p>
  </div>
  <div class="card" on:click={() => push('/addons/datapacks')}>
    <h2>🛠️ Datapacks</h2>
    <p>&gt;</p>
  </div>
</div>

<style>
    .addons-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        align-content: center;
        font-family: 'Press Start 2P', serif;
        width: 100%;
        height: 79vh;
    }

    .title {
        font-size: 35px;
    }

    .card {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 30px;
        margin: 10px;
        background-color: var(--background-contrast-color);
        border-radius: 10px;
        width: 500px;
        height: 75px;
        cursor: pointer;
        transition-duration: 150ms;
    }

    .card:hover {
        border-radius: 10px;
        transform: scaleX(1.05);
    }

    .card h2 {
        justify-content: flex-start;
        font-size: 17.5px;
        font-weight: 500;
    }

    .card p {
        font-size: 20px;
        transform: translateX(50px);
        opacity: 0;
        transition-duration: 150ms;
    }

    .card:hover p {
        opacity: 100%;
        transform: translateX(0px);
    }
</style>
