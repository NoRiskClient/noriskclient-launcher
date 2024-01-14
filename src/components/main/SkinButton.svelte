<script>
  import Modal from "../account/AccountModal.svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { createEventDispatcher } from "svelte";
  import { scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import SteveSkin from "../../images/steve_head.png";

  const dispatch = createEventDispatcher();

  let skinHovered = false;
  export let options;

  function handleSkinHover() {
    skinHovered = true;
  }

  function handleSkinHoverOut() {
    skinHovered = false;
  }

  let showModal = false;
  $: uuid = options.currentUuid

  const handleAddAccount = async () => {
    await invoke("login_norisk_microsoft").then(async (loginData) => {
      console.debug("Received Login Data...", loginData);

      options.currentUuid = loginData.uuid;

      // Index des vorhandenen Objekts mit derselben UUID suchen
      let existingIndex = options.accounts.findIndex(obj => obj.uuid === loginData.uuid);
      if (existingIndex !== -1) {
        console.debug("Replace Account");
        options.accounts[existingIndex] = loginData;
      } else {
        console.debug("Add New Account");
        options.accounts.push(loginData);
      }

      options.store();
    }).catch(e => {
      console.error("microsoft authentication error", e);
      alert(e);
    });
  };

  let image = null;
  $: image;
</script>

<div transition:scale={{ x: 15, duration: 300, easing: quintOut }}>
  <Modal bind:options={options} bind:showModal></Modal>
  <div class="skin-kopf-container"
       on:mouseenter={handleSkinHover}
       on:mouseleave={handleSkinHoverOut}>
    {#if uuid !== null}
        <img class="skin-kopf"
             src={`https://mineskin.eu/helm/${uuid}/150.png`}
             alt="Skin Kopf"
             on:click={()=>dispatch("launch")}
        >
        <div on:click={() => (showModal = true)} class="tag">*</div>
    {:else}
      <img class="skin-kopf"
           src={SteveSkin}
           alt="Skin Kopf"
           on:click={handleAddAccount}
      >
    {/if}
  </div>
</div>
<style>

    .skin-kopf-container {
        height: 100%;
        position: relative;
        transition: transform 0.3s;
    }

    .skin-kopf {
        cursor: pointer;
        box-shadow: 0px 0px 3px 0px rgba(12, 10, 10, 0.75);
        border-radius: 0.2em;
    }

    .skin-kopf-container:hover {
        position: relative;
        transform: scale(1.2);
    }

    .tag {
        font-family: 'Press Start 2P', serif;
        font-size: 20px;
        margin: 0;
        color: #b7b7b7;
        text-shadow: 2px 2px #000000;
        float: right;
        position: absolute;
        right: 0px;
        top: 0px;
        z-index: 1000;
        padding: 5px;
        font-weight: bold;
        cursor: pointer;
        transition: transform 0.3s, color 0.25s;
    }

    .tag:hover {
        transform: scale(1.2);
        color: var(--secondary-color);
    }
</style>
