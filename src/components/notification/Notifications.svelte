<script>
  import Notification from "./Notification.svelte";
  import { notifications } from "../../stores/notificationStore.js";
</script>

<style>
  .notifications {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    z-index: 10000;
  }
</style>

<div class="notifications">
  {#each $notifications as { id, type, details, message }}
    <Notification id={id} type={type} message={message} details={details} />
  {/each}
</div>
