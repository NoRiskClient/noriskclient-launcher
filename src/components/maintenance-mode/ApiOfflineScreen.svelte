<script>
    import { appWindow } from "@tauri-apps/api/window";
	import { translations } from './../../utils/translationUtils.js';

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;
</script>

<div class="container">
    <div class="api-offline">
        <h1 class="title text primary-text">{lang.apiOffline.title}</h1>
        <p class="text">{@html lang.apiOffline.text}</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="status" on:click={() => window.open("https://status.norisk.gg", "_blanc")}>-&gt; Status</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <p class="discord" on:click={() => window.open("https://discord.norisk.gg", "_blanc")}>-&gt; Discord</p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="quit-button red-text" on:click={() => { appWindow.close(); }}>{lang.apiOffline.button.exit}</h1>
    </div>
</div>

<style>
    .text {
            text-align: center;
        line-height: 17.5px;
        width: 95%;
    }

    .api-offline {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
    }

    .api-offline .title {
        margin-top: 50px;
        font-size: 30px;
        margin-bottom: 1em;
    }

    .api-offline p {
        font-size: 15px;
        padding: 0px 35px;
    }

    .api-offline .status {
        cursor: pointer;
        color: #167e23;
        text-shadow: 2px 2px #1a5922;
        font-size: 23px;
        margin-top: 20px;
        transition-duration: 200ms;
    }

    .api-offline .status:hover {
        transform: scale(1.2);
    }

    .api-offline .discord {
        cursor: pointer;
        color: #7289da;
        text-shadow: 2px 2px #4d5d97;
        font-size: 20px;
        margin-top: 20px;
        transition-duration: 200ms;
    }

    .api-offline .discord:hover {
        transform: scale(1.2);
    }

    .quit-button {
        cursor: pointer;
        margin-top: 100px;
            text-align: center;
        font-size: 40px;
        cursor: pointer;
        transition-duration: 300ms;
    }

    .quit-button:hover {
        transform: scale(1.3);
    }
</style>