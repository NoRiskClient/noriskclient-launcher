<script>
  export let text;
  export let logLevel = 'inherit';
  export let logStyles = {};

  function getLogStyle(logLevel) {

    if (logLevel === 'WARN') {
      const style = logStyles.warn || { color: 'inherit', textShadow: 'none' };
      return `color: ${style.color}; text-shadow: ${style.textShadow};`;
    }
    if (logLevel === 'ERROR') {
      const style = logStyles.error || { color: 'inherit', textShadow: 'none' };
      return `color: ${style.color}; text-shadow: ${style.textShadow};`;
    }
    if (logLevel === "FATAL") {
      const style = logStyles.fatal || { color: 'inherit', textShadow: 'none' };
      return `color: ${style.color}; text-shadow: ${style.textShadow};`;
    }
    return 'color: inherit; text-shadow: none;';
  }
</script>

<pre class="message" style={getLogStyle(logLevel)}>{text}</pre>

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