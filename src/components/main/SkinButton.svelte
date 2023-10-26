<script>
  import Modal from "../account/AccountModal.svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { createEventDispatcher, onMount } from "svelte";
  import { scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import FallBackSkin from "../../images/fallback_skin_kopf.png";

  const dispatch = createEventDispatcher();

  let skinHovered = false;
  export let options;

  function handleSkinHover() {
    skinHovered = true;
  }

  function handleSkinHoverOut() {
    skinHovered = false;
  }

  let faceDataUrl;
  let showModal = false;
  $: uuid = options.currentUuid

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

  async function getPlayerHead() {
    if (!uuid) {
      return;
    }
    await invoke("get_player_skins", { uuid: uuid })
    .then(async (profileTextures) => {
      let profileTexture = profileTextures[0]
      if (profileTexture) {
        profileTexture = JSON.parse(atob(profileTexture))
        await invoke("read_remote_image_file", { location: profileTexture.textures.SKIN.url })
        .then((content) => {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const image = new Image();

          const x = 8;
          const y = 8;
          const width = 8;
          const height = 8;

          image.src = `data:image/png;base64,${content}`;

          image.onload = () => {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(image, x, y, width, height, 0, 0, width, height);

            const upscaledCanvas = document.createElement('canvas');
            const upscaledContext = upscaledCanvas.getContext('2d');

            upscaledCanvas.width = 128;
            upscaledCanvas.height = 128;

            upscaledContext.imageSmoothingEnabled = false;

            upscaledContext.drawImage(canvas, 0, 0, width, height, 0, 0, 128, 128)

            faceDataUrl = upscaledCanvas.toDataURL('image/png');
            console.log('Extracted face data URL:', faceDataUrl);
          };
        })
        .catch((err) => {
          console.error(err);
        })
      }
    })
    .catch((err) => {
      alert(err);
    })
  };

  onMount(async () => {
    await getPlayerHead();
  })
</script>

<div transition:scale={{ x: 15, duration: 300, easing: quintOut }}>
  <Modal bind:options={options} bind:showModal></Modal>
  <div class="skin-kopf-container"
       on:mouseenter={handleSkinHover}
       on:mouseleave={handleSkinHoverOut}>
    {#if uuid !== null}
      {#if faceDataUrl == null}
        <img class="skin-kopf"
             src={FallBackSkin}
             alt="Skin Kopf"
        >
      {:else}
        <img class="skin-kopf"
             src={faceDataUrl}
             alt="Skin Kopf"
             on:click={()=>dispatch("launch")}
        >
        <div on:click={() => (showModal = true)} class="tag">*</div>
      {/if}
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
