<script>
  import { invoke } from "@tauri-apps/api";
  import { onMount } from "svelte";
  import WorldItem from "./WorldItem.svelte";
  import DatapacksScreen from "./DatapacksScreen.svelte";
  import VirtualList from "../../utils/VirtualList.svelte";
  import { branches, currentBranchIndex } from "../../../stores/branchesStore.js";
  import { addNotification } from "../../../stores/notificationStore.js";

  $: currentBranch = $branches[$currentBranchIndex];

  let world;
  let worlds = [];

  async function loadWorlds() {
    await invoke("get_world_folders", { branch: currentBranch }).then((result) => {
      worlds = result;
    }).catch((error) => {
      addNotification(error);
    });
  }

  onMount(() => {
    loadWorlds();
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
{#if world == null}
  <div class="wrapper">
    <h1 class="title">Worlds</h1>
    <div style="height: 65px;"></div>
    {#if worlds.length > 0}
      <VirtualList height="30em" items={worlds} let:item>
        <WorldItem icon="🌍" name={item} onClick={() => world = item} />
      </VirtualList>
    {:else}
      <h2 style="marin-top: 200px;">No worlds found.</h2>
    {/if}
  </div>
{:else}
  <DatapacksScreen world={world} />
{/if}

<style>
    .wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        align-content: center;
        font-family: 'Press Start 2P', serif;
        width: 100%;
        height: 79vh;
    }

    .title {
        font-size: 35px;
        margin-top: 1.5em;
    }
</style>
