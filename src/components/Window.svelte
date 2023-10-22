<script>
  import { invoke } from "@tauri-apps/api";
  import PokemonScreen from "./main/PokemonScreen.svelte";
  import StartUpScreen from "./updater/StartUpScreen.svelte";
  import UpdateManager from "./updater/UpdateManager.svelte";
  import { checkUpdate } from "@tauri-apps/api/updater";
  import { onMount } from "svelte";

  // Load options from file
  let options;
  let accounts = [];
  let showUpdateScreen = null;

  onMount(async () => {
    const reload = async () => await invoke("get_options").then(async (result) => {
      options = result;
      accounts = options.accounts;

      // Debug options - might be interesting to see what's in there
      console.debug("read options", options);

      // Easy way to store options
      options.store = function() {
        console.debug("storing options", options);
        invoke("store_options", { options }).catch(e => console.error(e));
      };

      options.reload = reload;

      options.toggleTheme = function() {
        if (options.theme === "LIGHT") {
          options.theme = "DARK";
          window.document.body.classList.add("dark-mode");
        } else {
          options.theme = "LIGHT";
          window.document.body.classList.remove("dark-mode");
        }
        invoke("store_options", { options }).catch(e => console.error(e));
      };

      if (options.theme === "DARK") {
        window.document.body.classList.add("dark-mode");
      } else {
        window.document.body.classList.remove("dark-mode");
      }

      if (options.currentUuid !== null) {
        invoke("refresh_via_norisk", { loginData: options.accounts.find(obj => obj.uuid === options.currentUuid) })
          .then((account) => {
            console.debug("Current UUID", options.currentUuid);
            console.debug("Account UUID", account.uuid);
            // Index des vorhandenen Objekts mit derselben UUID suchen
            let existingIndex = options.accounts.findIndex(obj => obj.uuid === account.uuid);
            if (existingIndex !== -1) {
              console.debug("###Replaced Refreshed  Account");
              options.accounts[existingIndex] = account;
            } else {
              console.debug("###Added Refreshed Account");
              options.accounts.push(account);
            }

            options.store();
          })
          .catch(e => console.error(e));
      }

      try {
        const { shouldUpdate } = await checkUpdate();
        showUpdateScreen = shouldUpdate;
        console.debug("Checking for Updates...", shouldUpdate);
      } catch (error) {
        showUpdateScreen = false;
        console.error(error);
      }
    });
    reload()
  });


  invoke("check_online_status").then((result) => {
    console.debug("online status", result);
  }).catch(e => {
    alert("You are offline! Please connect to the internet and restart the app.\n If this problem persists, please contact the developer.\n\n (Error: " + e + ")");
    console.error(e);
  });
</script>

<div class="window">
  {#if options !== undefined }
    {#if showUpdateScreen !== null}
      {#if showUpdateScreen}
        <UpdateManager />
      {:else}
        <PokemonScreen bind:options={options}></PokemonScreen>
      {/if}
    {:else}
      <StartUpScreen />
    {/if}
  {:else}
    <h1>Loading options...</h1>
  {/if}
</div>
