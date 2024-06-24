<script>
  import { fade } from "svelte/transition";

  export let message = "";
  export let id;
</script>

<style>
    .notification {
        background-color: #f44336;
        color: white;
        padding: 16px;
        margin: 8px 0;
        position: relative;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        text-shadow: none;
    }
</style>

<div class="notification" transition:fade>
  {message}
</div>
