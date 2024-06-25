<script>
  import { branches } from "../../stores/branchesStore.js";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { get } from "svelte/store";
  import { push } from "svelte-spa-router";
  import { appWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";

  let navItems = [
    { name: "SETTINGS", onClick: () => push("/launcher-settings"), condition: true },
    {
      name: "PROFILES",
      onClick: () => push("/profiles"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    /*
      Hallo Tim ich habe wirklich probiert es zu fixen, aber ich muss jetzt weitermachen damit wir ich schlafen kann ok
      ich setze mich nochmal dran wenn du mich pingst
    {
      name: "SERVERS",
      onClick: () => console.log("Servers clicked"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },*/
    {
      name: "ADDONS",
      onClick: () => push("/addons"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    {
      name: "CAPES",
      onClick: () => push("/capes"),
      condition: () => get(branches).length > 0 && get(defaultUser) != null,
    },
    /*
    Ich habs wirklich probiert aber Overflow hat gekickt
    {
      name: "SKIN",
      onClick: () => push("/skin"),
      condition: () => get(defaultUser) != null,
    },*/
    {
      name: "QUIT", onClick: () => {
        appWindow.close();
      }, condition: true, className: "quit",
    },
  ];

  navItems = navItems.sort((a, b) => b.name.length - a.name.length);

  branches.subscribe(value => {
    navItems = navItems.sort((a, b) => b.name.length - a.name.length);
  });

  defaultUser.subscribe(value => {
    navItems = navItems.sort((a, b) => b.name.length - a.name.length);
  });

  onMount(async () => {
    const branchesUnlisten = branches.subscribe(value => {
      navItems = navItems.sort((a, b) => b.name.length - a.name.length);
    });

    const userUnlisten = defaultUser.subscribe(value => {
      navItems = navItems.sort((a, b) => b.name.length - a.name.length);
    });

    return () => {
      branchesUnlisten();
      userUnlisten();
    };
  });
</script>
<div class="container">
  <div class="home-navbar-wrapper topleft">
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
        pointer-events: none
    }

    .topleft {
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
        pointer-events: all;
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
