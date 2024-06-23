<script>
  import { branches } from "../../stores/branchesStore.js";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { get } from "svelte/store";
  import { push } from "svelte-spa-router";

  let navItems = [
    { name: "SETTINGS", onClick: () => push("/launcher-settings"), condition: true },
    {
      name: "PROFILES",
      onClick: () => console.log("Profiles clicked"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    {
      name: "SERVERS",
      onClick: () => console.log("Servers clicked"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    {
      name: "ADDONS",
      onClick: () => console.log("Addons clicked"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    {
      name: "CAPES",
      onClick: () => console.log("Capes clicked"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    {
      name: "SKIN",
      onClick: () => push("/skin"),
      condition: () => get(defaultUser) != null,
    },
    { name: "QUIT", onClick: () => console.log("Quit clicked"), condition: true, className: "quit" },
  ];

  navItems = navItems.sort((a, b) => b.name.length - a.name.length);
</script>
<div class="container">
  <div class="home-navbar-wrapper topright">
    {#each navItems as item (item.name)}
      {#if typeof item.condition === 'function' ? item.condition() : item.condition}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <h1 class={item.className || ''} on:click={item.onClick}>
          {item.name}
        </h1>
      {/if}
    {/each}
  </div>
</div>

<style>
    .container {
        position: absolute;
        width: 720px;
        height: 80vh;
    }

    .topright {
        position: absolute;
        top: 0;
        right: 0;
    }

    .home-navbar-wrapper {
        position: absolute;
        padding: 10px;
        display: flex;
        flex-direction: column;
        align-items: end;
        border: 1px solid red;
    }

    .home-navbar-wrapper h1 {
        font-size: 11px;
        font-family: 'Press Start 2P', serif;
        margin-bottom: 1em;
        cursor: pointer;
        color: var(--secondary-color);
        text-shadow: 1px 1px var(--secondary-color-text-shadow);
        transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
    }

    .home-navbar-wrapper h1:hover {
        color: var(--hover-color);
        text-shadow: 1px 1px var(--hover-color-text-shadow);
        transform: scale(1.2);
    }

    .home-navbar-wrapper h1.quit:hover {
        color: red;
        text-shadow: 1px 1px #460000;
        transform: scale(1.2);
    }

    .home-navbar-wrapper h1.invite-button {
        display: flex;
        flex-direction: row;
        align-items: center;
        font-size: 12.5px;
    }

    .home-navbar-wrapper h1.invite-button p {
        margin-bottom: 5px;
        padding-right: 5px;
        font-size: 15px;
    }
</style>
