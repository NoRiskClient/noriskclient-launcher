<script>
    import {createEventDispatcher} from "svelte";
    import NRCLogo from "../../../images/norisk_logo.png";

    const dispatch = createEventDispatcher()

    export let server;
</script>

<div class="server-item-wrapper">
    <div class="image-text-wrapper">
        <!-- svelte-ignore a11y-img-redundant-alt -->
        <img class="icon" src={NRCLogo} alt="Server Icon">
        <div class="text-item-wrapper">
            <div class="name-wrapper">
                <h4 class="server-name">{"NAME"}</h4>
            </div>
            <p>{server.subdomain}.{server.domain}</p>
        </div>
    </div>
    <div class="buttons">
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class="details-button" on:click={() => dispatch("openDetails")}>
            DETAILS
        </h1>
    </div>
</div>

<style>
    .server-item-wrapper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--background-contrast-color);
        height: 120px;
        border-radius: 10px;
        padding: 1em;
        margin-bottom: 10px;
        gap: 1em;
        margin-top: 0.3em;
        cursor: default;
    }

    .buttons {
        margin-right: 10px;
    }

    .image-text-wrapper {
        justify-content: center;
        align-items: center;
        display: flex;
        gap: 1em;
    }
    
    .image-text-wrapper img {
        border-radius: 5px;
    }

    .name-wrapper {
        display: flex;
        align-items: center;
        gap: 0.7em;
    }

    .text-item-wrapper {
        height: 100%;
        max-width: 400px;
    }

    .icon {
        width: 90px;
        height: 90px;
        background: var(--background-contrast-color);
        box-shadow: 3px 3px 1px rgba(0, 0, 0, 0.5);
    }

    .server-name {
        text-decoration-thickness: 0.1em;
        text-decoration: underline;
        font-family: 'Press Start 2P', serif;
        line-break: anywhere;
        font-size: 18px;
    }

    .server-item-wrapper p {
        width: 350px;
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        line-height: 1.2em;
        padding-top: 2em;
    }

    .details-button {
        font-family: 'Press Start 2P', serif;
        font-size: 17px;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: pointer;
        transition-duration: 200ms;
    }

    .details-button:hover {
        transform: scale(1.2);
    }
</style>
