<script>
  import Modal from "../account/AccountModal.svelte";
  import SteveSkin from "../../images/steve_head.png";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { startMicrosoftAuth } from "../../utils/microsoftUtils.js";
  import { runClient } from "../../utils/noriskUtils.js";
  import { branches, currentBranchIndex } from "../../stores/branchesStore.js";

  let showModal = false;

  let image = null;
  $: image;
</script>

<Modal bind:showModal></Modal>
<div class="skin-kopf-container">
  {#if $defaultUser}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <img class="skin-kopf"
         src={`https://mineskin.eu/helm/${$defaultUser.id}/150.png`}
         alt="Skin Kopf"
         on:click={() => { runClient($branches[$currentBranchIndex])}}
    >
    <!-- svelte-ignore a11y-click-events-have-key-events -->
  {:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <img class="skin-kopf"
         src={SteveSkin}
         alt="Skin Kopf"
         on:click={startMicrosoftAuth}
    >
  {/if}
</div>

<style>
    .skin-kopf-container {
        display: flex;
        justify-content: center;
        border: 1px solid red;
        position: relative;
    }

    .skin-kopf {
        cursor: pointer;
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.2em;
        transition: transform 0.3s;
    }

    .skin-kopf:hover {
        transform: scale(1.2);
    }
</style>
