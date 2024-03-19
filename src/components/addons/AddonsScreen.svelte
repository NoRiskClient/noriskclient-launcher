<script>
    import { createEventDispatcher } from "svelte";
    import ShadersScreen from "./shaders/ShadersScreen.svelte";
 
    const dispatch = createEventDispatcher()
  
    function preventSelection(event) {
      event.preventDefault();
    }
  
    export let currentBranch;
    export let options;
    export let launcherProfiles;
    
    let activeTab = "MAIN";

    function switchTab(tab) {
      activeTab = tab;
    }
  </script>
  
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  {#if activeTab == "MAIN"}
    <div class="wrapper" on:selectstart={preventSelection}>
      <h1 class="title">Addons</h1>
      <div class="card" style="margin-top: 60px;" on:click={() => switchTab('MODS')}>
        <h2>📦 Mods</h2>
        <p>&gt;</p>
      </div>
      <div class="card" on:click={() => switchTab('RESOURCE_PACKS')}>
        <h2>🎨 Resource Packs</h2>
        <p>&gt;</p>
      </div>
      <div class="card" on:click={() => switchTab('SHADERS')}>
        <h2>🔮 Shaders</h2>
        <p>&gt;</p>
      </div>
      <div class="card" on:click={() => switchTab('DATAPACKS')}>
        <h2>🛠️ Datapacks</h2>
        <p>&gt;</p>
      </div>
    </div>
    <h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>
  {:else if activeTab == "MODS"}
  {:else if activeTab == "RESOURCE_PACKS"}
  {:else if activeTab == "SHADERS"}
    <ShadersScreen on:home={() => dispatch('home')} on:back={() => switchTab('MAIN')} bind:options bind:launcherProfiles bind:currentBranch={currentBranch}/>
  {:else if activeTab == "DATAPACKS"}
  {:else}
    <h2 style="display: flex; justify-content: center; align-items: center; font-family: 'Press Start 2P', serif;">WTF happened here!?!?!?</h2>
    <h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>
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

      .card {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 30px;
        margin: 10px;
        background-color: var(--background-contrast-color);
        border-radius: 10px;
        width: 500px;
        height: 75px;
        cursor: pointer;
        transition-duration: 150ms;
      }
      
      .card:hover {
        border-radius: 10px;
        transform: scaleX(1.05);
      }

      .card h2 {
        justify-content: flex-start;
        font-size: 17.5px;
      }

      .card p {
        font-size: 20px;
        transform: translateX(50px);
        opacity: 0;
        transition-duration: 150ms;
      }

      .card:hover p {
        opacity: 100%;
        transform: translateX(0px);
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
  