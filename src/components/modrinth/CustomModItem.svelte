<script>
    import {createEventDispatcher} from "svelte";

    import NoRiskClientLogo from "../../images/norisk_logo.png"

    const dispatch = createEventDispatcher()

    let isDisabled
    $: isDisabled = mod.endsWith(".disabled")

    export let mod;
</script>

<div class="mod-item-wrapper" class:disabled={isDisabled} class:enabled={!isDisabled}>
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        <img src={NoRiskClientLogo} alt="Mod Picture">
        <div class="text-wrapper">
            <a href={"https://modrinth.com/mod/"} target="_blank" title="Modrinth Page">
                {mod.replace(".disabled", "")}
            </a>
            <p>Custom Mod</p>
        </div>
    </div>
    <div class="button-wrapper">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="install-button red-text-clickable" class:enable-button={isDisabled}
            on:click={() => dispatch("togglemod")}>
            {#if isDisabled}
                ENABLE
            {:else}
                DISABLE
            {/if}
        </h1>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="install-button red-text-clickable" on:click={() => dispatch("delete")}>
            DELETE
        </h1>
    </div>
</div>

<style>
    .mod-item-wrapper {
        display: flex;
        border: 3px solid black;
        align-items: center;
        justify-content: space-between;
        padding: 1em;
        gap: 1em;
        margin-top: 0.3em;
    }

    .enabled {
        background-color: rgba(0, 255, 0, 0.5);
    }

    .disabled {
        background-color: rgba(255, 0, 0, 0.5);
    }

    .image-text-wrapper {
        justify-content: center;
        align-items: start;
        display: flex;
        gap: 1em;
    }

    .text-wrapper {
        display: flex;
        flex-direction: column;
        gap: 2em;
    }

    .button-wrapper {
        display: flex;
        flex-direction: column;
        gap: 1em;
        align-items: center;
    }

    .mod-item-wrapper img {
        width: 90px;
        height: 90px;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
    }

    .mod-item-wrapper a:first-child {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        font-size: 13px;
        cursor: pointer;
    }

    .enable-button {
        color: #00ff00;
        text-shadow: 2px 2px #086b08;
    }

    p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
    }

    .install-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        transition: transform 0.3s;
    }

    .install-button:hover {
        transform: scale(1.2);
    }
</style>
