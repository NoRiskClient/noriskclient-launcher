<script>
    export let item;
    export let log = null;

    function getCurrentTimestamp() {
        const date = new Date();
        return `[${date.getHours() < 10 ? "0" + date.getHours() : date.getHours()}:${date.getMinutes() < 9 ? "0" + date.getMinutes() : date.getMinutes()}:${date.getSeconds() < 9 ? "0" + date.getSeconds() : date.getSeconds()}]`;
    }
</script>

{#if item.startsWith('[') && item.split(']: ').slice(1).join(']: ').trim() != ''}
    <div class="logRow">
        <p class="timestamp">{item.split(' ')[0]}</p>
        <p class={`${item.split('/')[1].split(']: ')[0]}`}>{item.split('/')[1].split(']: ')[0]}</p>
        <p style={item.split('/')[1].split(']: ')[0] == 'WARN' ? 'color: #ff9100;' : item.split('/')[1].split(']: ')[0] == 'ERROR' ? 'color: #ff0000;' : ''} class:ERROR={item.split('/')[1].split(']: ')[0] == 'ERROR'}>{@html log != null ? log : item.split(']: ').slice(1).join(']: ')}</p>
    </div>
{:else if item.trim() != ''}
    <div class="logRow">
        <p class="timestamp">{getCurrentTimestamp()}</p>
        <p class="INFO">LOG</p>
        <p>{item}</p>
    </div>
{/if}

<style>
    .logRow {
        display: flex;
        flex-direction: row;
        width: 95vw;
        overflow: hidden;
        gap: 1em;
    }

    .logRow p {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        text-shadow: none;
        margin-bottom: 5px;
        line-height: 20px;
        cursor: default;
    }

    .logRow p:nth-child(3) {
        line-break: anywhere;
        font-family: monospace;
        font-size: 14px;
        user-select: text;
        word-break: break-word;
        overflow-wrap: anywhere;
        line-break: anywhere;
        text-shadow: none;
        color: var(--font-color);
    }

    .timestamp {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #868080;
        text-shadow: none;
    }

    .INFO {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: var(--primary-color);
        text-shadow: none;
    }

    .WARN {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #ff9100;
        text-shadow: none;
    }

    .ERROR {
        font-family: 'Press Start 2P', serif;
        font-size: 10px;
        color: #ff0000;
        text-shadow: none;
    }
</style>
