<script>
	import { activeChangeLog } from './../../utils/popupUtils.js';
    import { translations } from '../../utils/translationUtils.js';
    
    /** @type {{ [key: string]: any }} */
    $: lang = $translations;
</script>

<div class="container">
    <h1 class="title">{lang.changeLog.title}</h1>
    <h2 class="version">Version {$activeChangeLog?.version ?? ''}</h2>
    <div class="content">
        {#each $activeChangeLog?.changes ?? [] as change}
            <p
                class="change"
                class:ADDED={change.startsWith('+') || change.toUpperCase().startsWith('ADDED')}
                class:REMOVED={change.startsWith('-') || change.toUpperCase().startsWith('REMOVED')}
            >{@html change}</p>
        {/each}
    </div>
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin-top: 20px;
        overflow-y: hidden;
        font-family: 'Press Start 2P', serif;
    }

    .title {
        font-size: 2em;
        display: flex;
    }

    .version {
        margin-top: 1em;
        font-size: 1.25em;
        display: flex;
    }

    .content {
        margin-top: 2em;
        display: flex;
        flex-direction: column;
        align-items: start;
        justify-content: center;
        overflow-y: scroll;
        width: 80vw;
        height: 60vh;
        gap: 5px;
    }

    .change {
        font-size: 0.9em;
        margin-bottom: 10px;
        text-shadow: none;
    }

    .REMOVED {
        color: #ff0000;
    }

    .ADDED {
        color: #00ff00;
    }
</style>