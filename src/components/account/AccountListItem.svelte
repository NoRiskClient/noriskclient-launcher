<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";

  export let account;
  export let isActive;
  export let options;
  export let dialog;

  let faceDataUrl;

  function getRandomObjectOrNull(array) {
    if (array.length === 0) {
      return null; // Wenn das Array leer ist, geben wir null zurück
    }

    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
  }

  async function getPlayerHead() {
    await invoke("get_player_skins", { uuid: account.uuid })
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

  function handleSelectAccount() {
    if (options.currentUuid !== account.uuid) {
      options.currentUuid = account.uuid;
      options = options;
      options.store();
    }
  }

  function handleRemoveAccount() {
    options.accounts = options.accounts.filter(entry => entry.uuid !== account.uuid);
    options.currentUuid = getRandomObjectOrNull(options.accounts)?.uuid ?? null;
    options = options;
    options.store();
    invoke("remove_account", { loginData: account })

    if (options.currentUuid === null) {
      dialog.close();
    }
  }

  onMount(async () => {
    await getPlayerHead();
  })
</script>

<div class="flex-wrapper" on:click={handleSelectAccount} class:active={isActive}>
  <div class="skin-text-wrapper">
    <img src={faceDataUrl} alt="{account.username}'s Kopf">
    <h1 class:active={isActive}>{account.username}</h1>
  </div>
  <h1 class="remove-button" on:click={handleRemoveAccount}>X</h1>
</div>
<hr>

<style>
    h1 {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
    }

    .flex-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 30px;
        justify-content: space-between;
        align-content: space-between;
        width: 100%;
        padding: 15px;
        transition: background-color 0.3s;
    }

    .flex-wrapper:hover {
        background: var(--background-contrast-color);
    }

    .active {
      color: #0bb00b;
      text-shadow: 2px 2px #086b08;
    }

    .skin-text-wrapper {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        width: 100%;
    }

    img {
        width: 50px;
        box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.6);
    }

    .remove-button {
      cursor: pointer;
    }
</style>
