<script>
    import {invoke} from "@tauri-apps/api";
    import { createEventDispatcher } from "svelte";
    import WorldItem from "./WorldItem.svelte";
    import DatapacksScreen from "./DatapacksScreen.svelte";
    import VirtualList from "../../utils/VirtualList.svelte";
 
    const dispatch = createEventDispatcher()
  
    function preventSelection(event) {
      event.preventDefault();
    }
  
    export let currentBranch;
    export let options;
    export let launcherProfiles;
    
    let world;
    let worlds = [];

    async function loadWorlds() {
        await invoke("get_world_folders", { branch: currentBranch }).then((result) => {
            worlds = result;
        }).catch((e) => {
            alert(e);
        });
    }

    loadWorlds();
  </script>
  
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  {#if world == null}
    <div class="wrapper" on:selectstart={preventSelection}>
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
    <h1 class="home-button" style="left: 220px;" on:click={() => dispatch("back")}>[BACK]</h1>
    <h1 class="home-button" style="right: 220px;" on:click={() => dispatch("home")}>[HOME]</h1>
  {:else}
    <DatapacksScreen on:back={() => world = null} on:home={() => dispatch('home')} bind:currentBranch={currentBranch} bind:options={options} bind:launcherProfiles={launcherProfiles} world={world} />
  {/if}
  
  <style>
      * {
        overflow: hidden;
      }

      .wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: 'Press Start 2P', serif;
        width: fit-content;
        height: fit-content;
      }

      .title {
        font-size: 35px;
        position: absolute;
        top: 2.5em;
      }
  
      .home-button {
          position: absolute;
          bottom: 1em; /* Abstand vom oberen Rand anpassen */
          transition: transform 0.3s;
          font-size: 20px;
          color: #e8e8e8;
          text-shadow: 2px 2px #7a7777;
          font-family: 'Press Start 2P', serif;
          cursor: pointer;
      }
  
      .home-button:hover {
          transform: scale(1.2);
      }
  </style>
  