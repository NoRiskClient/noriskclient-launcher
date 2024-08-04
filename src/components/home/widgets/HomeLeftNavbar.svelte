<script>
  import { openInfoPopup, openConfirmPopup, openInputPopup, openErrorPopup } from "../../../utils/popupUtils.js";
  import { defaultUser } from "../../../stores/credentialsStore.js";
  import { onMount } from "svelte";
  import { openDiscordIntegration } from "../../../utils/discordUtils.js";
  import { get } from "svelte/store";
  import { branches } from "../../../stores/branchesStore.js";
  import { launcherOptions } from "../../../stores/optionsStore.js";
  import { invoke } from "@tauri-apps/api";
  import { noriskError, noriskLog } from "../../../utils/noriskUtils.js";
  import { addNotification } from "../../../stores/notificationStore.js";

  let discordLinked = false;
  let navItems = [];

  function updateNavItems() {
    navItems = [
      {
        name: discordLinked ? "UNLINK DISCORD" : "LINK DISCORD",
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
      },
      {
        name: "INFO POPUP",
        onClick: () => {
          openInfoPopup({ title: "Welcome to NoRiskClient!", content: "We are happy to see you here! If you have any questions or problems, feel free to ask us in our Discord server. You can find the link in the footer of the launcher.", onClose: () => { alert("CLOSED!") }, titleFontSize: "17.5px", contentFontSize: "15px" });
        },
        condition: () => true,
      },
      {
        name: "CONFIRM POPUP",
        onClick: () => {
          openConfirmPopup({
            title: "Are you sure?",
            content: "This action is irreversible!",
            onConfirm: () => { },
            onCancel: () => { }
          });
        },
        condition: () => true,
      },
      {
        name: "INPUT POPUP",
        onClick: () => {
          openInputPopup({
            title: "Enter your name",
            content: "Please enter your name:",
            inputType: "FOLDER",
            inputName: "Minecraft Directory",
            inputValue: "",
            inputPlaceholder: "Detect Automatically",
            confirmButton: "Apply",
            validateInput: (input) => { alert(`Validating: ${input}`) },
            onConfirm: (input) => { alert("You entered: " + input) },
            onCancel: () => { alert("CANCELLED!") },
            titleFontSize: "20px"
          });
        },
        condition: () => true,
      },
      {
        name: "ERROR POPUP",
        onClick: () => {
          openErrorPopup({ title: "An error occurred!", content: "Something went wrong!", onClose: () => { alert("CLOSED!") }, titleFontSize: "25px" });
        },
        condition: () => true,
      },
    ];
  }

  onMount(async () => {
    const userUnlisten = defaultUser.subscribe(async value => {
      await fetchDiscordLinkStatus();
      updateNavItems();
    });

    const branchesUnlisten = branches.subscribe(async value => {
      await fetchDiscordLinkStatus();
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
    return await invoke("discord_auth_status", { options, credentials })
      .then((value) => {
        discordLinked = value;
        noriskLog("Is Discord Linked: " + discordLinked);
        updateNavItems();
      })
      .catch((err) => {
        discordLinked = false;
        noriskError(err);
        addNotification(err);
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
        noriskLog("Unlinked Discord" + discordLinked);
      })
      .catch((err) => {
        noriskError(err);
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
    transform: scale(1.2) translateX(12.5px);
  }
</style>
