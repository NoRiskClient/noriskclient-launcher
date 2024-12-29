<script>
  import SteveSkin from "../../../images/steve_head.png";
  import FallbackSkin from "/src/images/fallback_skin_head.png";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { startMicrosoftAuth } from "../../../utils/microsoftUtils.js";
  import { runClient } from "../../../utils/noriskUtils.js";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";

  let canStart = true;

  async function handleStart() {
    if (!canStart) return
    canStart = false;
    await runClient($branches[$currentBranchIndex]);
    canStart = true;
  }
</script>

<div class="skin-head-container">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="skin-click" on:click={$defaultUser ? handleStart : startMicrosoftAuth}></div>
  {#if $defaultUser}
    <img class="skin-head"
         src={`https://crafatar.com/avatars/${$defaultUser.id}?size=150&overlay`}
         alt=" "
         onerror="this.src='{FallbackSkin}'"
    >
  {:else}
    <img class="skin-head zoom glow"
         src={SteveSkin}
         alt="Skin Head"
    >
  {/if}
</div>

<style>
    .skin-head-container {
        position: relative;
        transition: transform 0.3s;
        margin-top: 10px;
    }

    .skin-head {
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

    .skin-head-container:hover {
        position: relative;
        transform: scale(1.2);
        cursor: pointer;
    }

    .skin-head-container:hover .skin-head {
        border-radius: 0.25em;
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
