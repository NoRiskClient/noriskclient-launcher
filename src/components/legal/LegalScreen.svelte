<script>
    import { open } from '@tauri-apps/api/shell';
    import { preventSelection } from "../../utils/svelteUtils.js";
    import { translations } from '../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    function openUrl(url) {
        open(url);
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="container" on:selectstart={preventSelection}>
    <h1 class="title">{lang.legal.title}</h1>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="card" style="margin-top: 60px;" on:click={() => openUrl("https://norisk.gg/privacy-policy")}>
        <h2>🔐 {lang.legal.button.privacyPolicy}</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => openUrl("https://norisk.gg/terms-of-service")}>
        <h2>📝 {lang.legal.button.termsOfService}</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => openUrl("https://norisk.gg/open-source-licences")}>
        <h2>📜 {lang.legal.button.openSourceLicenses}</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => openUrl("https://norisk.gg/used-libraries")}>
        <h2>📦 {lang.legal.button.usedLibraries}</h2>
        <p>&gt;</p>
    </div>
    <div class="card" on:click={() => openUrl("https://norisk.gg/imprint")}>
        <h2>📨 {lang.legal.button.imprint}</h2>
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