<script>
  import Modal from "../account/AccountModal.svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { createEventDispatcher } from "svelte";
  import { scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import FallBackSkin from "../../images/fallback_skin_kopf.png"

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

  const handleAddAccount = async () => {
    await invoke("login_norisk_microsoft").then((loginData) => {
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

  const preload = async (src) => {
    const resp = await fetch(src);
    const blob = await resp.blob();

    return new Promise(function (resolve) {
      let reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => console.error('Error: ', error);
    });
  };
</script>

<div transition:scale={{ x: 15, duration: 300, easing: quintOut }}>
  <Modal bind:options={options} bind:showModal></Modal>
  <div class="skin-kopf-container"
       on:mouseenter={handleSkinHover}
       on:mouseleave={handleSkinHoverOut}>
    {#if options.currentUuid !== null}

      {#await preload("https://crafatar.com/avatars/"+options.currentUuid+"?overlay")}
        <img class="skin-kopf"
             src={FallBackSkin}
             alt="Skin Kopf"
        >
      {:then base64}
        <img class="skin-kopf"
             src={base64}
             alt="Skin Kopf"
             on:click={()=>dispatch("launch")}
        >
        <div on:click={() => (showModal = true)} class="tag">*</div>
      {/await}
    {:else}
      <img class="skin-kopf"
           src={"https://crafatar.com/avatars/c06f8906-4c8a-4911-9c29-ea1dbd1aab82"}
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
