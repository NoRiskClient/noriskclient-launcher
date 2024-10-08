<script>
  import DOMPurify from 'dompurify';
  export let text;

  $: sanitizedText = DOMPurify.sanitize(text, {ALLOWED_TAGS: ['span']});
</script>

<!-- TODO Log Highlighting -->
<pre class="message">{@html sanitizedText}</pre>

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
