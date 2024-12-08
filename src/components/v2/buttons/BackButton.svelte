<script>
    import { pop, location } from "svelte-spa-router";
    import { activeChangeLog, lastViewedPopups, saveLastViewedPopups } from "../../../utils/popupUtils.js";
	import { translations } from '../../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;
    
    function back() {
        if ($location == "/changeLog") {
            const version = $activeChangeLog?.version;
            
            lastViewedPopups.update(value => {
                value.changelog = version;
                return value;
            });

            // Pop before setting to null to prevent null exception
            pop();

            activeChangeLog.set(null);
            saveLastViewedPopups();
        } else {
            pop();
        }
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<h1 class="back-button" on:click={back}>[{lang.main.buttons.back}]</h1>

<style>
    .back-button {
        transition: transform 0.3s;
        position: absolute;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
            cursor: pointer;
    }

    .back-button:hover {
        transform: scale(1.2);
    }
</style>
