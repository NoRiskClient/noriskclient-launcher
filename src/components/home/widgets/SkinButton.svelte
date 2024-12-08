<script>
  import Modal from "../../account/AccountModal.svelte";
  import SteveSkin from "../../../images/steve_head.png";
  import FallbackSkin from "/src/images/fallback_skin_kopf.png";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { startMicrosoftAuth } from "../../../utils/microsoftUtils.js";
  import { runClient } from "../../../utils/noriskUtils.js";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";

  let showModal = false;
  let canStart = true;

  async function handleStart() {
    if (!canStart) return
    canStart = false;
    await runClient($branches[$currentBranchIndex]);
    canStart = true;
  }
</script>

<Modal bind:showModal />
<div class="skin-kopf-container">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="skin-click" on:click={$defaultUser ? handleStart : startMicrosoftAuth}></div>
  {#if $defaultUser}
    <img class="skin-kopf"
         src={`https://crafatar.com/avatars/${$defaultUser.id}?size=150&overlay`}
         alt=" "
         onerror="this.src='{FallbackSkin}'"
    >
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div on:click={() => (showModal = true)} class="tag">*</div>
  {:else}
    <img class="skin-kopf zoom glow"
         src={SteveSkin}
         alt="Skin Head"
    >
  {/if}
</div>

<style>
    .skin-kopf-container {
        position: relative;
        transition: transform 0.3s;
        margin-top: 10px;
    }

    .skin-kopf {
        -webkit-user-drag: none;
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.45em;
        transition-duration: 200ms;
    }

    .skin-click {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    }

    .skin-kopf-container:hover {
        position: relative;
        transform: scale(1.2);
        cursor: pointer;
    }

    .skin-kopf-container:hover .skin-kopf {
        border-radius: 0.25em;
    }

    .tag {
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
        transition: transform 0.3s, color 0.25s;
    }

    .tag:hover {
        transform: scale(1.2);
        color: var(--secondary-color);
    }

    .zoom {
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.2em;
        animation: zoom 5s ease infinite;
    }

    @keyframes zoom {
        0% {
            transform: scale(1, 1);
        }
        50% {
            transform: scale(0.95, 0.95);
        }
        100% {
            transform: scale(1, 1);
        }
    }

    .glow {
        box-shadow: 0 0 15px var(--primary-color);
    }

</style>
