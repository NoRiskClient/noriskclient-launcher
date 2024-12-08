<script>
	import { translations } from './../../../utils/translationUtils.js';
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { onMount } from "svelte";
  import { openDiscordIntegration } from "../../../utils/discordUtils.js";
  import { get } from "svelte/store";
  import { branches } from "../../../stores/branchesStore.js";
  import { launcherOptions } from "../../../stores/optionsStore.js";
  import { invoke } from "@tauri-apps/api";
    import {isApiOnline, noriskLog} from "../../../utils/noriskUtils.js";
  import { addNotification } from "../../../stores/notificationStore.js";

  let discordLinked = false;
  let navItems = [];

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  function updateNavItems() {
    navItems = [
      {
        name: discordLinked ? lang.home.leftNavbar.button.unlinkDiscord : lang.home.leftNavbar.button.linkDiscord,
        onClick: async () => {
          if (discordLinked) {
            await unlinkDiscord();
            await fetchDiscordLinkStatus();
          } else {
            await openDiscordIntegration();
            await fetchDiscordLinkStatus();
          }
        },
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
      }
    ];
  }

  onMount(async () => {
    const userUnlisten = defaultUser.subscribe(async () => {
      await fetchDiscordLinkStatus();
      updateNavItems();
    });

    const branchesUnlisten = branches.subscribe(async () => {
      updateNavItems();
    });

    updateNavItems();

    return () => {
      userUnlisten();
      branchesUnlisten();
    };
  });

  async function fetchDiscordLinkStatus() {
    let credentials = get(defaultUser);
    let options = get(launcherOptions);
    if (!credentials) return false;
    if (!options) return false;
    if (!get(isApiOnline)) return false;
    return await invoke("discord_auth_status", { options, credentials })
      .then((value) => {
        discordLinked = value;
        noriskLog("Is Discord Linked: " + discordLinked);
        updateNavItems();
      })
      .catch((error) => {
        discordLinked = false;
        addNotification(error);
        updateNavItems();
      });
  }

  async function unlinkDiscord() {
    let credentials = get(defaultUser);
    let options = get(launcherOptions);
    if (!credentials) return;
    if (!options) return;
    return await invoke("discord_auth_unlink", { options, credentials })
      .then((value) => {
        discordLinked = false;
        addNotification(lang.home.notification.discordUnlinkSuccess, "INFO");
        noriskLog("Unlinked Discord" + discordLinked);
      })
      .catch((error) => {
        addNotification(error);
      });
  }
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
    pointer-events: none;
  }

  .topleft {
    position: absolute;
    top: 0;
    left: 0;
  }

  .home-navbar-wrapper {
    position: absolute;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: start;
    pointer-events: all;
  }

  .home-navbar-wrapper h1 {
    font-size: 11px;
    margin-bottom: 1em;
    cursor: pointer;
    color: var(--secondary-color);
    text-shadow: 1px 1px var(--secondary-color-text-shadow);
    transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
  }

  .home-navbar-wrapper h1:hover {
    color: var(--hover-color);
    text-shadow: 1px 1px var(--hover-color-text-shadow);
    transform: scale(1.2) translateX(12.5px) perspective(1px);
  }
</style>
