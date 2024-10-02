<script>
  export let showCreditsModal;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="copyright" on:click={() => showCreditsModal = true}>
  © 2000-{new Date().getFullYear()} HGLabor/Friends Inc. v0.5.10
</div>

<style>
    .copyright {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        margin-top: 0.3em;
        text-shadow: 1px 1px var(--hover-color-text-shadow);
        color: var(--hover-color);
        cursor: pointer;
    }
</style>
