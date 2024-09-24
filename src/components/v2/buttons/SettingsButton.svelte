<script>
  import { push } from "svelte-spa-router";
</script>

<div class="settings-button">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <p on:click={() => push("/launcher-settings")}>Settings</p>
</div>

<style>
    p {
        transition: 0.3s;
        font-size: 0.7rem;
        color: #716f6f;
        text-align: left;
        text-shadow: 2px 2px #333232;
        font-family: 'Press Start 2P', serif;
        display: inline;
    }

    p:hover {
        color: #939393;
        text-shadow: 2px 2px #6a6a6a;
        cursor: pointer;
    }
</style>
