<script>
	import { appWindow } from '@tauri-apps/api/window';
  import { preventSelection } from "../utils/svelteUtils.js";
  import { invoke } from '@tauri-apps/api';
  import { onMount } from "svelte";
  import { fetchOptions, launcherOptions } from "../stores/optionsStore.js";
  import { checkUpdate, installUpdate, onUpdaterEvent } from "@tauri-apps/api/updater";
  import { relaunch } from "@tauri-apps/api/process";
  import { noriskLog, noriskError } from "../utils/noriskUtils.js";
  import Logo from "../images/norisk_logo.png";
  import OfflineLogo from "../images/norisk_logo_dead.png";

  let dots = "";
  let text = null;
  let error = "";
  let copyErrorButton = "Copy Error";

  onMount(async () => {
    let interval = animateLoadingText();
    fetchOptions();

    noriskLog("Checking internet connection");
    let hasConnection = false;
    await invoke("has_internet_connection").then(result => {
      hasConnection = result;
      noriskLog(`Internet connection: ${result}`);
    })
    
    text = hasConnection ? "Checking for Updates" : null;
    if (!text) return appWindow.show();

    const unlisten = await onUpdaterEvent(({ error, status }) => {
      // This will log all updater events, including status updates and errors.
      noriskLog(`Updater event -> Err: ${error} Status: ${status}`);
      error = error;
    });

    try {
      const { shouldUpdate, manifest } = await checkUpdate();

      if (shouldUpdate) {
        appWindow.show();
        noriskLog(`Installing update: ${manifest?.version} ${manifest?.body}`);
        text = "Installing Update";

        // Install the update. This will also restart the app on Windows!
        await installUpdate().catch(reason => {
          noriskError(reason);
        });
        noriskLog(`Update was installed`);
        text = "Restarting";

        noriskLog(`Trying to relaunch`);

        await relaunch().catch(reason => {
          noriskError(reason);
        });
      } else {
        noriskLog(`No updates available`);
        text = "";
        if (error.trim() == "") {
          await invoke("close_updater").then(() => {
            noriskLog(`updater closed -> Main window shown`);
          }).catch(reason => {
            noriskError(`Failed to close updater / show main window: ${reason}`);
          });
        } else {
          appWindow.show();
        }
      }
    } catch (error) {
      noriskError(error);
    }

    return () => {
      clearInterval(interval);
      unlisten();
    };
  });

  function animateLoadingText() {
    return setInterval(function() {
      dots += ".";
      if (dots.length > 3) {
        dots = "";
      }
    }, 500);
  }

  function copyError() {
    navigator.clipboard.writeText(error);
    copyErrorButton = "Copied!";
    setTimeout(() => {
      copyErrorButton = "Copy Error";
    }, 1000);
  }
</script>


<div class="container" class:dark-mode={$launcherOptions?.theme == "DARK"} data-tauri-drag-region>
  <div class="content" on:selectstart={preventSelection} on:mousedown={preventSelection}>
    <img style={`opacity: ${text == null ? '0.3' : '1'};`} src={text != null ? Logo : OfflineLogo} alt="NoRiskClient Logo">
    {#if text == null}
      <p class="branch-font offline">OFFLINE!</p>
    {:else if error.trim() == ""}
      <p class="branch-font primary-text">{text}{dots}</p>
    {:else}
      <p class="branch-font red-text">ERROR! :(</p>
    {/if}
  </div>
  {#if text == null}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <p class="copy-error red-text" on:click={() => invoke("quit")}>Exit</p>
  {:else if error.trim() != ""}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <p class="copy-error primary-text" on:click={() => copyError()}>{copyErrorButton}</p>
  {/if}
</div>

<style>
  .container {
    height: 100vh;
    width: 100vw;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    cursor: default;
  }

  .content {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    height: 70%;
    width: 100%;
  }

  img {
    width: 200px;
    height: 200px;
    -webkit-user-drag: none;
    -webkit-mask:linear-gradient(-60deg,#fff 40%,#0005 50%,#fff 60%) right/275% 100%; /* right/275% 100%: length and hight of mask */
    animation: effect 3.5s infinite; /* remove infinite to trigger once */
  }
  
  @keyframes effect {
    0% { transform: scale(1.0); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1.0); -webkit-mask-position:left }
  }

  .branch-font {
    font-family: 'Press Start 2P', serif;
    font-size: 14px;
    margin-top: 2em;
  }

  .offline {
    font-size: 20px;
    opacity: 0.5;
  }

  .copy-error {
    font-family: 'Press Start 2P', serif;
    font-size: 16px;
    text-shadow: none;
    margin-top: 1em;
    text-align: center;
    transition-duration: 200ms;
    cursor: pointer;
  }

  .copy-error:hover {
    transform: scale(1.2);
  }
</style>
