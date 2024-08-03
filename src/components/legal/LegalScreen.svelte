<script>
    import { preventSelection } from "../../utils/svelteUtils.js";
    import { push } from "svelte-spa-router";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="container" on:selectstart={preventSelection}>
    <h1 class="title">Legal Information</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="card" style="margin-top: 60px;" on:click={() => window.open("https://norisk.gg/privacy-policy", "_blanc")}> <!-- push('/legal/privacy-policy') -->
        <h2>🔐 Privacy Policy</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => window.open("https://norisk.gg/terms-of-service", "_blanc")}> <!-- push('/legal/terms-of-service') -->
        <h2>📝 Terms of Service</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => window.open("https://norisk.gg/open-source-licences", "_blanc")}> <!-- push('/legal/open-source-licences') -->
        <h2>📜 Open Source Licences</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => window.open("https://norisk.gg/used-libraries", "_blanc")}> <!-- push('/legal/used-libraries') -->
        <h2>📦 Used Libraries</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => window.open("https://norisk.gg/imprint", "_blanc")}> <!-- push('/legal/imprint') -->
        <h2>📨 Imprint</h2>
        <p>&gt;</p>
    </div>
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 80vh;
        width: 100vw;
        font-family: 'Press Start 2P', serif;
        color: var(--font-color);
        padding-top: 2em;
        text-shadow: 2px 2px var(--font-color-text-shadow);
    }

    .title {
        font-size: 30px;
    }

    .card {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
        margin-bottom: 15px;
        background-color: var(--background-contrast-color);
        border-radius: 10px;
        width: 500px;
        height: 60px;
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