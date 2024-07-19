<script>
  import { branches } from "../../stores/branchesStore.js";
  import { defaultUser } from "../../stores/credentialsStore.js";
  import { get } from "svelte/store";
  import { push } from "svelte-spa-router";
  import { appWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api";
  import { getNoRiskToken, noriskError, noriskLog, getFeatureWhitelist, featureWhitelist } from "../../utils/noriskUtils.js";
  import InvitePopup from "../invite/InvitePopup.svelte";
  import { addNotification } from "../../stores/notificationStore.js";

  let showInvitePopup = false;
  let friendInviteSlots = {};

  let navItems = [];

  function updateNavItems() {
    navItems = [
      
      { name: "SETTINGS", onClick: () => push("/launcher-settings"), condition: true },
      {
        name: "PROFILES",
        onClick: () => push("/profiles"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
      },
      {
        name: "SERVERS",
        onClick: () => push("/servers"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
      },
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
      {
        name: "INVITE",
        onClick: () => { showInvitePopup = true; },
        condition: () => get(branches).length > 0 && get(defaultUser) != null && $featureWhitelist.includes("INVITE_FRIENDS") && friendInviteSlots.availableSlots == -1,
      },
      {
        name: "SKIN",
        onClick: () => push("/skin"),
        condition: () => get(defaultUser) != null,
      },
      {
        name: "QUIT", onClick: () => {
          appWindow.close();
        }, condition: true, className: "quit",
      },
    ].sort((a, b) => b.name.length - a.name.length);
  }


  onMount(async () => {
    const branchesUnlisten = branches.subscribe(async value => {
      await fetchFeatures();
      updateNavItems();
    });

    const userUnlisten = defaultUser.subscribe(async value => {
      await fetchFeatures();
      updateNavItems();
      console.log(featureWhitelist, friendInviteSlots)
    });

    return () => {
      branchesUnlisten();
      userUnlisten();
    };
  });

  async function fetchFeatures() {
    await getFeatureWhitelist();

    if ($featureWhitelist.includes("INVITE_FRIENDS")) {
      await loadFriendInvites();
    }
  }

  async function loadFriendInvites() {
    if (!$defaultUser) return;
    await invoke("get_whitelist_slots", {
      noriskToken: getNoRiskToken(),
      uuid: $defaultUser.id,
    }).then((result) => {
      noriskLog("Received Whitelist Slots" + JSON.stringify(result));
      friendInviteSlots = result;
    }).catch((reason) => {
      noriskError(reason);
      addNotification(reason);
      friendInviteSlots = {};
    });
  }
</script>

{#if showInvitePopup}
  <InvitePopup on:getInviteSlots={loadFriendInvites} bind:showModal={showInvitePopup} bind:friendInviteSlots />
{/if}
<div class="container">
  <div class="home-navbar-wrapper topleft">
    {#if $featureWhitelist.includes("INVITE_FRIENDS") && friendInviteSlots.availableSlots !== -1 && friendInviteSlots.availableSlots - friendInviteSlots.previousInvites > 0}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="invite-button" on:click={() => showInvitePopup = true}>
        <p>✨ INVITE ✨</p>
      </h1>
    {/if}
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
