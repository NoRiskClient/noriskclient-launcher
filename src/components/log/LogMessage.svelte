<script>
  export let text;
</script>

<!-- TODO Log Highlighting -->
<pre class="message">{text}</pre>

<style>
    .message {
        font-family: monospace;
        font-size: 11px;
        user-select: text;
        word-break: break-word;
        overflow-wrap: anywhere;
        text-shadow: none;
    }
</style>
