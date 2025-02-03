<script>
	import { focusState } from './../stores/performanceStore.js';
	import { launcherOptions } from './../stores/optionsStore.js';
	import { users } from './../stores/credentialsStore.js';
  import { preventSelection } from "../utils/svelteUtils.js";
  import { defaultUser } from "../stores/credentialsStore.js";
  import { quintOut } from "svelte/easing";
  import { branches, branchSubtitles, currentBranchIndex, switchBranch } from "../stores/branchesStore.js";
  import { scale } from "svelte/transition";
  import { isCheckingForUpdates } from "../utils/noriskUtils.js";
  import Updater from "./v2/Updater.svelte";
  import SignInOutput from "./home/widgets/SignInOutput.svelte";
  import { translations } from '../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  export let allowBranchSwitching = true;
</script>

<div class="branch-wrapper">
  {#if allowBranchSwitching && $branches.length > 1}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
        on:selectstart={preventSelection} style="cursor: pointer"
        on:mousedown={preventSelection} class="branch-font switch primary-text"
        on:click={() => switchBranch(true)}
        style:opacity={($defaultUser == null || $isCheckingForUpdates)? 0 : 100}>
      &lt;</h1>
  {/if}
  <section style="display: flex; justify-content: center; margin-bottom: 1em;">
    {#if $isCheckingForUpdates}
      <Updater />
    {:else if $users.length < 1}
      <SignInOutput />
    {:else}
      {#if $branches.length > 0}
        {#each $branches as branch, i}
          {#if $currentBranchIndex === i}
            <div class="branch-name-container">
              <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
              <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
                  class="branch-font primary-text"
                  class:branch-effect={!$launcherOptions.potatoMode}
                  class:paused={!$focusState}
                  on:selectstart={preventSelection}
                  on:mousedown={preventSelection}
              > {lang.branchSwitcher.branch.replace("{branch}", branch.toUpperCase())}</h1>
              {#if $branchSubtitles[i]}
                <p transition:scale={{ x: 15, duration: 300, easing: quintOut }} 
                  class="subtitle">{$branchSubtitles[i].toUpperCase()}</p>
              {/if}  
            </div>
          {/if}
        {/each}
      {:else}
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
            class="branch-font primary-text"
            style="position:absolute"
            on:selectstart={preventSelection}
            on:mousedown={preventSelection}
        > {lang.branchSwitcher.notWhitelisted}</h1>
      {/if}
    {/if}
  </section>
  {#if allowBranchSwitching && $branches.length > 1}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <h1 transition:scale={{ x: 15, duration: 300, easing: quintOut }}
        on:selectstart={preventSelection}
        style="cursor: pointer" on:mousedown={preventSelection}
        class="branch-font primary-text switch" on:click={() => switchBranch(false)}
        style:opacity={($defaultUser == null || $isCheckingForUpdates) ? 0 : 100}>
      &gt;</h1>
  {/if}
</div>

<style>
    .branch-wrapper {
        display: flex;
        align-content: space-evenly;
        flex-direction: row;
        margin-bottom: 1em;
        gap: 200px
    }

    .branch-name-container {
      position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
    }

    .subtitle {
        font-size: 12px;
        text-shadow: 1px 1px var(--font-color-text-shadow);
        margin: 0;
        cursor: default;
        width: max-content;
    }

    .branch-font {
        font-size: 18px;
        margin: 0;
        cursor: default;
  }

  .switch {
    z-index: 100;
  }
  
    .switch:hover {
        color: var(--hover-color);
        text-shadow: 2px 2px var(--hover-color-text-shadow);
    }
  
    .branch-effect{
        -webkit-mask:linear-gradient(-60deg,#fff 40%,#0005 50%,#fff 60%) right/275% 100%;
        animation: effect 4.5s infinite;
    }

    .branch-effect.paused {
        animation-play-state: paused !important;
    }

    @keyframes effect {
        100% {-webkit-mask-position:left}
    }

</style>
