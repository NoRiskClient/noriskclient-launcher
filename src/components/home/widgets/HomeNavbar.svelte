<script>
  import { branches } from "../../../stores/branchesStore.js";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { get } from "svelte/store";
  import AccountModal from "../../account/AccountModal.svelte";
  import { push } from "svelte-spa-router";
  import { appWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api";
  import { getNoRiskToken, noriskLog, getFeatureWhitelist, featureWhitelist, getNoRiskUser } from "../../../utils/noriskUtils.js";
  import { openInputPopup } from "../../../utils/popupUtils.js";
  import { addNotification } from "../../../stores/notificationStore.js";
  import { translations } from '../../../utils/translationUtils.js';
  import { fade, slide } from "svelte/transition";

  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  let friendInviteSlots = {};
  let showAccountModal = false;

  let navItems = [];
  let hovered;

  function updateNavItems() {
    navItems = [
      {
        name: lang.home.navbar.button.legalInfo,
        onClick: () => push("/legal"),
        condition: () => true,
        submenues: []
      },
      {
        name: lang.home.navbar.button.settings,
        onClick: () => push("/launcher-settings"),
        condition: true,
        submenues: []
      },
      {
        name: lang.home.navbar.button.accounts,
        onClick: () => showAccountModal = true,
        condition: () => true,
        submenues: []
      },
      {
        name: lang.home.navbar.button.profiles,
        onClick: () => push("/profiles"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
        submenues: []
      },
      {
        name: lang.home.navbar.button.servers,
        onClick: () => push("/servers"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
        submenues: []
      },
      {
        name: lang.home.navbar.button.addons,
        onClick: () => push("/addons"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
        submenues: [
          {
            name: lang.home.navbar.button.mods,
            onClick: () => push("/addons/mods"),
            condition: () => get(branches).length > 0 && get(defaultUser) != null,
          }
        ]
      },
      {
        name: lang.home.navbar.button.invite,
        onClick: openInviteFriendsPopup,
        condition: () => get(branches).length > 0 && get(defaultUser) != null && $featureWhitelist.includes("INVITE_FRIENDS") && friendInviteSlots.availableSlots == -1,
        submenues: []
      },
      {
        name: lang.home.navbar.button.capes,
        onClick: () => push("/capes"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
        submenues: []
      },
      {
        name: lang.home.navbar.button.skin,
        onClick: () => push("/skin"),
        condition: () => get(branches).length > 0 && get(defaultUser) != null,
        submenues: []
      },
      {
        name: lang.home.navbar.button.quit,
        onClick: () => appWindow.close(),
        condition: true,
        className: "quit",
        submenues: []
      },
    ];
  }


  onMount(async () => {
    const branchesUnlisten = branches.subscribe(async value => {
      updateNavItems();
    });

    const userUnlisten = defaultUser.subscribe(async value => {
      updateNavItems();
      await getNoRiskUser();
        await fetchFeatures();
        updateNavItems();
    });

    return () => {
      branchesUnlisten();
      userUnlisten();
    };
  });

  async function fetchFeatures() {
    friendInviteSlots = {};
    await getFeatureWhitelist();

    if ($featureWhitelist.includes("INVITE_FRIENDS") === true) {
      await loadFriendInvites();
    }
  }

  async function loadFriendInvites() {
    friendInviteSlots = {};
    if (!$defaultUser) return;
    await invoke("get_whitelist_slots", {
      noriskToken: getNoRiskToken(),
      uuid: $defaultUser.id,
    }).then((result) => {
      noriskLog("Received Whitelist Slots" + JSON.stringify(result));
      friendInviteSlots = result;
      friendInviteSlots.text = friendInviteSlots.availableSlots === -1 ? '∞' : `${friendInviteSlots.availableSlots - friendInviteSlots.previousInvites}/${friendInviteSlots.availableSlots}`;
    }).catch((reason) => {
      addNotification(reason);
      friendInviteSlots = {};
    });
  }

  function openInviteFriendsPopup() {
    openInputPopup({
      title: lang.home.navbar.popup.inviteFriends.title,
      content: lang.home.navbar.popup.inviteFriends.content.replace("{slots}", friendInviteSlots.text),
      inputPlaceholder: lang.home.navbar.popup.inviteFriends.inputPlaceholder,
      confirmButton: lang.home.navbar.popup.inviteFriends.confirmButton,
      height: 22,
      contentFontSize: 14,
      validateInput: (input) => input.length > 2 && (input.length <= 16 || input.length == 36),
      onConfirm: async (identifier) => {
          await invoke("add_player_to_whitelist", {
              identifier: identifier,
              noriskToken: getNoRiskToken(),
              requestUuid: $defaultUser.id,
          }).then(async () => {
              addNotification(lang.home.navbar.notification.invite.success.replace("{user}", identifier), "INFO");
              await loadFriendInvites();
          }).catch((error) => {
              addNotification(lang.home.navbar.notification.invite.error.replace("{user}", identifier).replace("{error}", error));
          });
      }
    })
  }
</script>

<AccountModal bind:showModal={showAccountModal} />
<div class="container">
  <div class="home-navbar-wrapper topleft">
    {#if $featureWhitelist.includes("INVITE_FRIENDS") && friendInviteSlots.availableSlots !== -1 && friendInviteSlots.availableSlots - friendInviteSlots.previousInvites > 0}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <h1 class="invite-button" on:click={openInviteFriendsPopup}>
        <p>{lang.home.navbar.button.inviteFeature}</p>
      </h1>
    {/if}
    {#each navItems as item (item.name)}
      {#if typeof item.condition === 'function' ? item.condition() : item.condition}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div on:mouseenter={() => hovered = item.name} on:mouseleave={() => hovered = null}>
          <h1 class={item.className || ''} on:click={item.onClick}>
            {item.name}
          </h1>
          {#if hovered === item.name}
            {#each item.submenues as submenu}
              <h2 class={submenu.className || ''} on:click={submenu.onClick} transition:slide={{ duration: 100 }}>
                {submenu.name}
              </h2>
            {/each}
          {/if}
        </div>
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
    align-items: flex-end;
    width: 50%;
    text-align: right;
    pointer-events: all;
    overflow: hidden;
  }

  .home-navbar-wrapper h1 {
    font-size: 11px;
    margin-bottom: 1em;
    cursor: pointer;
    color: var(--secondary-color);
    text-shadow: 1px 1px var(--secondary-color-text-shadow);
    transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
  }

  .home-navbar-wrapper h2 {
      font-size: 11px;
      margin-bottom: 1em;
      cursor: pointer;
      color: var(--secondary-color);
      text-shadow: 1px 1px var(--secondary-color-text-shadow);
      transition: transform 0.3s, color 0.25s, text-shadow 0.25s;
  }

  .home-navbar-wrapper h2:hover {
      color: var(--hover-color);
      text-shadow: 1px 1px var(--hover-color-text-shadow);
      transform: scale(1.2) translateX(-10px) perspective(1px);
  }

  .home-navbar-wrapper h1:hover {
    color: var(--hover-color);
    text-shadow: 1px 1px var(--hover-color-text-shadow);
    transform: scale(1.2) translateX(-10px) perspective(1px);
  }

  .home-navbar-wrapper h1.quit:hover {
    color: red;
    text-shadow: 1px 1px #460000;
    transform: scale(1.2) perspective(1px);
  }

  .home-navbar-wrapper h1.invite-button {
    display: flex;
    flex-direction: row;
    align-items: center;
    font-size: 12.5px;
  }

  .home-navbar-wrapper h1.invite-button p {
    color: var(--hover-text-shadow);
    text-shadow: 1px 1px var(--secondary-color-text-shadow);
    margin-bottom: 5px;
    padding-right: 5px;
    font-size: 15px;
  }
</style>
