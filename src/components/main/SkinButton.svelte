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
    <div on:click={() => (showModal = true)} class="tag">*</div>
  {:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <img class="login-kopf"
         src={SteveSkin}
         alt="Skin Kopf"
         on:click={startMicrosoftAuth}
    >
  {/if}
</div>

<style>
    .skin-kopf-container {
        position: relative;
        transition: transform 0.3s;
    }

    .skin-kopf {
        cursor: pointer;
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.2em;
    }

    .login-kopf {
        cursor: pointer;
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.2em;
        animation: zoom 2s ease infinite;
    }
    
    .skin-kopf-container:hover {
        position: relative;
        transform: scale(1.2);
    }

    .tag {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin: 0;
        color: #b7b7b7;
        text-shadow: 2px 2px #000000;
        float: right;
        position: absolute;
        right: 0px;
        top: 0px;
        z-index: 1000;
        padding: 5px;
        font-weight: bold;
        cursor: pointer;
        transition: transform 0.3s, color 0.25s;
    }

    .tag:hover {
        transform: scale(1.2);
        color: var(--secondary-color);
    }
    
    @keyframes zoom {
  0% {
    transform: scale(1, 1);
  }
  20% {
    transform: scale(0.9, 0.9);
  }
  100% {
    transform: scale(1, 1);
  }
}
</style>
