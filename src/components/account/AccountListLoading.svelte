<script>
    import SteveSkin from "../../images/steve_head.png";

    import {onMount} from "svelte";
    import {listen} from "@tauri-apps/api/event";
    import {translations} from "../../utils/translationUtils.js";

    /** @type {{ [key: string]: any }} */
    $: lang = $translations;

    $: microsoftOutput = "LOADING";
    let dots = "";
    let microsoftFlag = false;

    onMount(async () => {
        let interval = animateLoadingText();

        const unlisten = await listen("microsoft-output", event => {
            if (!microsoftFlag) {
                microsoftFlag = true;
            }

            if (event.payload.includes('signIn.')) {
                let translatedStep = lang;
                event.payload.split('.').forEach(step => {
                    translatedStep = translatedStep[step];
                });
                microsoftOutput = translatedStep;
            } else {
                microsoftOutput = event.payload;
            }
        });

        return () => {
            unlisten();
            clearInterval(interval);
        };
    });

    function animateLoadingText() {
        return setInterval(function () {
            dots += " .";
            if (dots.length > 6) {
                dots = "";
            }
        }, 500);
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="flex-wrapper">
    <div class="skin-text-wrapper">
        <img src={`https://crafatar.com/avatars/b3519573-85a3-43e1-ac68-bf1b2937bd1a?size=50&overlay`} alt="Steve Head">
        <h1>{microsoftOutput}{dots}</h1>
    </div>
</div>
<hr>

<style>
    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 0.8em;
        margin-left: 10px;
    }

    .flex-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 30px;
        justify-content: space-between;
        align-content: space-between;
        width: 100%;
        padding: 15px;
        transition: background-color 0.3s;
    }

    .flex-wrapper:hover {
        background: var(--background-contrast-color);
    }

    .skin-text-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        width: 100%;
    }

    img {
        box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.6);
        border-radius: 0.2em;
        width: 50px;
    }

    .remove-button {
        cursor: pointer;
        transition-duration: 200ms;
    }

    .remove-button:hover {
        color: red;
        text-shadow: 2px 2px #8b0000;
        transform: scale(1.15);
    }
</style>
