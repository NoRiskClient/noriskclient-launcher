<script>
  import Notification from "./Notification.svelte";
  import { onMount } from "svelte";
  import { addNotification, notifications } from "../../stores/notificationStore.js";

  let notificationList = [];

  notifications.subscribe(value => {
    notificationList = value;
    console.log("Current Notifications:", notificationList);
  });

  onMount(() => {
    const delays = [1000, 2000, 3000, 4000, 5000, 6000];
    const messages = [
      "Initial error 1",
      "Initial error 2",
      "Initial error 3",
      "Initial error 4",
      "Initial error 5",
      "Initial error 6"
    ];

    messages.forEach((message, index) => {
      setTimeout(() => {
        addNotification(message, 5000 + index * 100);
      }, delays[index]);
    });
  });
</script>

<style>
    .notifications {
        position: fixed;
        bottom: 16px;
        right: 16px;
        display: flex;
        flex-direction: column-reverse;
        align-items: flex-end;
    }
</style>

<div class="notifications">
  {#each $notifications as { id, message, duration }}
    <Notification {id} {message} {duration} />
  {/each}
</div>
