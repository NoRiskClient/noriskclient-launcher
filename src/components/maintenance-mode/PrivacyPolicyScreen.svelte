<script>
	import { pop } from 'svelte-spa-router';
	import { invoke } from '@tauri-apps/api/tauri';
    import { appWindow } from "@tauri-apps/api/window";
    import { addNotification } from '../../stores/notificationStore.js';
	import { translations, setLanguage } from '../../utils/translationUtils.js';

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    async function accept() {
        await invoke("accept_privacy_policy").then(async () => {
            await invoke("check_privacy_policy").then(value => {
                if (!value) {
                    addNotification("Failed to accept privacy policy!");
                    return;
                } else {
                    setLanguage("en_US");
                    pop();
                }
            });
        }).catch(error => addNotification(error));
    }
</script>

<div class="container">
    <div class="privacy-policy">
        <h1 class="title text primary-text">{lang.privacyPolicy.title}</h1>
        <p class="text">{@html lang.privacyPolicy.text}</p>
        <div class="buttons">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="quit-button red-text" on:click={() => { appWindow.close(); }}>{lang.privacyPolicy.button.exit}</h1>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <h1 class="accept-button green-text" on:click={accept}>{lang.privacyPolicy.button.accept}</h1>
        </div>
    </div>
</div>

<style>
    .text {
        text-align: center;
        line-height: 25px;
        width: 95%;
    }

    .buttons {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        height: 2em;
        margin-top: 5em;
    }

    .privacy-policy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 80vh;
    }

    .privacy-policy .title {
        font-size: 30px;
        margin-bottom: 3em;
    }

    .privacy-policy p {
        font-size: 15px;
        padding: 0px 35px;
    }

    .quit-button {
        cursor: pointer;
        text-align: center;
        cursor: pointer;
        margin-right: 1.5em;
        font-size: 25px;
        transition-duration: 300ms;
    }

    .quit-button:hover {
        transform: scale(1.3);
    }

    .accept-button {
        cursor: pointer;
        text-align: center;
        cursor: pointer;
        margin-left: 1.5em;
        font-size: 25px;
        transition-duration: 300ms;
    }

    .accept-button:hover {
        transform: scale(1.3);
    }
</style>