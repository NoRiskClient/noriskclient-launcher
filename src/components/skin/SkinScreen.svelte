<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { open } from "@tauri-apps/api/dialog";
  import { listen } from '@tauri-apps/api/event';
  import { SkinViewer, IdleAnimation } from "skinview3d";

  const dispatch = createEventDispatcher()

  export let options;
  let isLoading = true;

  listen('tauri://file-drop', files => {
    if (unsavedSkin) {
        return;
    }
    previewSkin(files.payload[0])
  })

  let skinViewer;
  let currentSkinLocation;
  // let capeHash;
  let unsavedSkin;
  let unsavedSkinData;

  async function getSkins() {
    await invoke("get_player_skins", { uuid: options.currentUuid })
    .then(async (profileTextures) => {
      // await getNoRiskUserByUUID()
      let profileTexture = profileTextures[0]
      if (profileTexture) {
        profileTexture = JSON.parse(atob(profileTexture))
      }
      currentSkinLocation = profileTexture != null ? profileTexture.textures.SKIN.url : "../../images/default_skin.png";
      const canvas = document.createElement('canvas');
      skinViewer = new SkinViewer({
        canvas: canvas,
        width: 720,
        height: 517.5,
        skin: currentSkinLocation,
        // cape: `https://dl.hglabor.de/capes/prod/${capeHash}.png`,
        animation: new IdleAnimation
      });
      skinViewer.zoom = 0.65;
      skinViewer.autoRotate = true;
      document.getElementById("skin").appendChild(canvas)
    })
    .catch((err) => {
      alert(err);
    })
    isLoading = false;
  }

  // async function getNoRiskUserByUUID() {
  //   if (options.currentUuid !== null) {
  //     await invoke("get_cape_hash_by_uuid", {
  //       uuid: options.currentUuid,
  //     }).then((user) => {
  //       if (user) {
  //         console.log(user)
  //         capeHash = user;
  //       } else {
  //         console.log("No Cape Found");
  //       }
  //       isLoading = false;
  //     }).catch(e => {
  //       alert("Failed to Request User by UUID: " + e);
  //       console.error(e);
  //       isLoading = false;
  //     });
  //   }
  // }

  async function previewSkin(location) {
    await invoke("read_local_skin_file", { location })
    .then((content) => {
      console.log(`data:image/png;base64,${content}`)
      unsavedSkinData = content;
      skinViewer.loadSkin(`data:image/png;base64,${content}`)
      skinViewer.zoom = 0.65;
      unsavedSkin = location;
    }).catch((err) => {
      alert(err)
    })
  }

  function cancelSkinPreview() {
    skinViewer.loadSkin(currentSkinLocation)
    skinViewer.zoom = 0.65;
    unsavedSkin = null;
    unsavedSkinData = null;
  }
  
  async function saveSkin(imgData) {
    console.log(`Saving new player skin: ${imgData}`)
    await invoke("save_player_skin", { fileData: imgData, slim: false, accessToken: options.accounts.find(acc => acc.uuid == options.currentUuid).accessToken })
    .catch((err) => {
      console.error(err);
    })
    dispatch("home")
  }

  async function selectSkin() {
    try {
      const location = await open({
          defaultPath: '/',
          multiple: false,
          directory: false,
          filters: [{name: "Skin", extensions: ["png"]}]
        })
        if (location) {
          previewSkin(location)
        }
      } catch (e) {
        alert("Failed to select file using dialog")
      }
  }

  onMount(() => {
    getSkins()
  })

</script>

<div class="wrapper">
  <h1 class="title">Skin</h1>
  {#if isLoading}
    <h2>Loading...</h2>
  {/if}
  <div id="skin" on:mousedown={skinViewer.autoRotate = false} on:mouseup={skinViewer.autoRotate = true}></div>
  {#if !isLoading}
    {#if !unsavedSkin}
      <h1 class="change-button" on:click={selectSkin}>Change</h1>
    {:else}
      <div class="unsavedSkinActionWrapper">
        <h1 class="cancel-button" on:click={cancelSkinPreview}>Cancel</h1>
        <h1 class="save-button" on:click={async () => saveSkin(unsavedSkinData)}>Save</h1>
      </div>
    {/if}
  {/if}
</div>
<h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>

<style>
    .wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Press Start 2P', serif;
    }

    .title {
      font-size: 35px;
      cursor: pointer;
      position: absolute;
      top: 2.5em;
    }

    .change-button {
      top: 80%;
      position: absolute;
      flex: 1;
      margin-bottom: 175px;
      transition-duration: 0.1s;
    }
    
    .change-button:hover {
      color: var(--primary-color);
      transition-duration: 0.1s;
      transform: scale(1.2);
    }

    .unsavedSkinActionWrapper {
      position: absolute;
      display: flex;
      flex-direction: row;
      top: 80%;
      width: 50%;
      justify-content: space-between;
    }

    .unsavedSkinActionWrapper h1 {
      transition-duration: 0.3s;
    }
    
    .cancel-button {
      color: red;
    }
    
    .save-button {
      color: green;
    }

    .unsavedSkinActionWrapper h1:hover {
      transition-duration: 0.3s;
      transform: scale(1.2);
    }

    .home-button {
        position: absolute;
        bottom: 1em; /* Abstand vom oberen Rand anpassen */
        transition: transform 0.3s;
        font-size: 20px;
        color: #e8e8e8;
        text-shadow: 2px 2px #7a7777;
        font-family: 'Press Start 2P', serif;
        cursor: pointer;
    }

    .home-button:hover {
        transform: scale(1.2);
    }
</style>
