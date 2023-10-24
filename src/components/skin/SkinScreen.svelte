<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/tauri";
  import { open } from "@tauri-apps/api/dialog";
  import { listen } from '@tauri-apps/api/event';
  import ConfigRadioButton from "../config/inputs/ConfigRadioButton.svelte";
  import { SkinViewer, IdleAnimation } from "skinview3d";

  const dispatch = createEventDispatcher()

  function preventSelection(event) {
    event.preventDefault();
  }

  export let options;
  let isLoading = true;

  listen('tauri://file-drop', files => {
    if (settings.open || unsavedSkin || !files.payload[0].endsWith('.png')) {
        console.log(files.payload[0]);
        return;
    }
    previewSkin(files.payload[0])
  })

  let skinViewer;
  let currentSkinLocation;
  let capeLocation;
  let unsavedSkin;
  let unsavedSkinData;
  let settings = {
    showCape: true,
    showCapeAsElytra: false,
    rotatePlayer: true,
    open: false
  }

  async function getSkins() {
    await invoke("get_player_skins", { uuid: options.currentUuid })
    .then(async (profileTextures) => {
      let profileTexture = profileTextures[0]
      if (profileTexture) {
        profileTexture = JSON.parse(atob(profileTexture))
        await getNoRiskUserByUUID(profileTexture)
      }
      currentSkinLocation = profileTexture != null ? profileTexture.textures.SKIN.url : "../../images/default_skin.png";
      const canvas = document.createElement('canvas');
      skinViewer = new SkinViewer({
        canvas: canvas,
        width: 720,
        height: 520,
        skin: currentSkinLocation,
        cape: settings.showCape ? capeLocation : '',
        animation: new IdleAnimation
      });
      skinViewer.zoom = 0.65;
      skinViewer.autoRotate = settings.rotatePlayer;
      settings.showCape = capeLocation ? true : false;
      settings.showCapeBefore = capeLocation ? true : false;
      document.getElementById("skin").appendChild(canvas)
    })
    .catch((err) => {
      alert(err);
    })
    isLoading = false;
  }

  async function getNoRiskUserByUUID(profileTexture) {
    if (options.currentUuid !== null) {
      await invoke("get_cape_hash_by_uuid", {
        uuid: options.currentUuid,
      }).then(async (user) => {
        if (user) {
          await invoke("read_remote_cape_file", { location: `https://dl.hglabor.de/capes/prod/${user}.png` })
          .then((capeData) => {
            capeLocation = `data:image/png;base64,${capeData}`
          }).catch((err) => {
            console.error(err);
          })
        } else {
          capeLocation = profileTexture.textures.CAPE?.url ?? ""
          console.log("No NoRisk Cape Found");
        }
        isLoading = false;
      }).catch(e => {
        alert("Failed to Request User by UUID: " + e);
        console.error(e);
        isLoading = false;
      });
    }
  }

  async function previewSkin(location) {
    await invoke("read_local_skin_file", { location })
    .then((content) => {
      unsavedSkinData = content;
      skinViewer.loadSkin(`data:image/png;base64,${content}`)
      skinViewer.zoom = 0.65;
      unsavedSkin = location;
    }).catch((err) => {
      alert(err)
    })
  }

  function cancelSkinPreview() {
    if (settings.open) {
      return;
    }
    skinViewer.loadSkin(currentSkinLocation)
    skinViewer.zoom = 0.65;
    unsavedSkin = null;
    unsavedSkinData = null;
  }
  
  async function saveSkin(imgData) {
    if (settings.open) {
      return;
    }
    console.log(`Saving new player skin: ${imgData}`)
    await invoke("save_player_skin", { fileData: imgData, slim: false, accessToken: options.accounts.find(acc => acc.uuid == options.currentUuid).accessToken })
    .then(() => {
      getSkins()
    })
    .catch((err) => {
      console.error(err);
    })
  }

  async function selectSkin() {
    if (settings.open) {
      return;
    }
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

  function toggleSettings() {
    const sliders = Array.from(document.getElementsByClassName("slider"))
    settings.open = !settings.open;
    sliders.forEach(slider => {
      slider.classList.toggle("slide");
      slider.classList.toggle("no-slide");
      if (slider.classList.contains("title")) {
        if (slider.classList.contains("slide")) {
          slider.style = "top: 30%;";
        } else {
          slider.style = "";
        }
      } else if (slider.classList.contains("change-button")) {
        if (slider.classList.contains("slide")) {
          slider.style = "top: 65%;";
        } else {
          slider.style = "";
        }
      } else if (slider.classList.contains("unsavedSkinActionWrapper")) {
        if (slider.classList.contains("slide")) {
          slider.style = "top: 65%;";
        } else {
          slider.style = "";
        }
      }
    })
    const setting_sliders = Array.from(document.getElementsByClassName("setting-slider"))
    setting_sliders.forEach(slider => {
      slider.classList.toggle("no-slide");
      slider.classList.toggle("slide");
    })
  }

  setInterval(() => {
    if (capeLocation && (settings.showCape != settings.showCapeBefore)) {
      const showCapeAsElytraSetting = document.getElementById("showCapeAsElytraSetting")
      if (settings.showCape) {
        skinViewer.loadCape(capeLocation, { backEquipment: settings.showCapeAsElytra ? "elytra" : "cape" })
        showCapeAsElytraSetting.classList.add("slide")
        showCapeAsElytraSetting.classList.remove("no-slide")
      } else {
        skinViewer.loadCape(null)
        showCapeAsElytraSetting.classList.add("no-slide")
        showCapeAsElytraSetting.classList.remove("slide")
        settings.showCapeAsElytra = false;
        settings.showCapeAsElytraBefore = false;
      }
      settings.showCapeBefore = settings.showCape;
    } else if (settings.showCape && (settings.showCapeAsElytra != settings.showCapeAsElytraBefore)) {
      skinViewer.loadCape(capeLocation, { backEquipment: settings.showCapeAsElytra ? "elytra" : "cape" })
      settings.showCapeAsElytraBefore = settings.showCapeAsElytra;
    } else if (skinViewer.autoRotate != settings.rotatePlayer) {
      skinViewer.autoRotate = settings.rotatePlayer;
    }
  }, 100);

  onMount(() => {
    getSkins()
  })

</script>

{#if settings.open}
  <div class="klickField" on:click={settings.open ? toggleSettings : () => {}}></div>
{/if}
  <div class="wrapper" on:selectstart={preventSelection}>
  <div class="slider slide"></div>
  <h1 class="title slider">Skin</h1>
  {#if isLoading}
  <h2>Loading...</h2>
  {/if}
  <div id="skin" class="skin slider" on:selectstart={preventSelection} on:mousedown={() => {settings.rotatePlayerBefore = settings.rotatePlayer; settings.rotatePlayer = false}} on:mouseup={() => {settings.rotatePlayer = settings.rotatePlayerBefore; settings.rotatePlayerBefore = false}}></div>
  {#if !isLoading}
    <div id="settings" class="settings open">
      <svg on:click={toggleSettings} xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px">
        <path d="M0 0h24v24H0V0z" fill="none" />
        <path
          d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
      </svg>
      <div class="setting setting-slider no-slide" style="margin-top: 70px">
        <ConfigRadioButton bind:value={settings.rotatePlayer} text="Rotate Player" reversed></ConfigRadioButton>
      </div>
      {#if capeLocation}
        <div class="setting setting-slider no-slide">
          <ConfigRadioButton bind:value={settings.showCape} text="Show Cape" reversed></ConfigRadioButton>
        </div>
        <div id="showCapeAsElytraSetting" class="setting setting-slider no-slide">
          <ConfigRadioButton bind:value={settings.showCapeAsElytra} text="Elytra" reversed></ConfigRadioButton>
        </div>
      {/if}
    </div>
    {#if !unsavedSkin}
      <h1 class="change-button slider no-slide" on:click={selectSkin}>Change</h1>
    {:else}
      <div class="unsavedSkinActionWrapper slider no-slide">
        <h1 class="cancel-button" on:click={cancelSkinPreview}>Cancel</h1>
        <h1 class="save-button" on:click={async () => saveSkin(unsavedSkinData)}>Save</h1>
      </div>
    {/if}
  {/if}
</div>
<h1 class="home-button" on:click={() => dispatch("home")}>[BACK]</h1>

<style>
    * {
      overflow: hidden;
    }
    .wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: 'Press Start 2P', serif;
    }

    .title {
      font-size: 35px;
      position: absolute;
      top: 2.5em;
    }

    .klickField {
      position: absolute;
      top: 10vh;
      height: 520px;
      width: 720px;
    }

    .slider {
      transition-duration: 0.3s;
    }
    
    .slider.slide {
      transition-duration: 0.3s;
      transform: translateX(-140px) scale(0.5);
    }

    .settings {
      position: absolute;
      display: flex;
      flex-direction: column;
      justify-content: start;
      left: 62.5%;
      top: 70px;
    }

    .settings svg {
      position: absolute;
      font-size: 40px;
      left: 210px;
      top: 10px;
      height: 40px;
      width: 40px;
      fill: white;
      transition-duration: 0.3s;
      transform: rotateY(0);
    }
    
    .settings svg:hover {
      transition-duration: 0.3s;
      transform: scale(1.2);
      cursor: pointer;
    }

    .setting {
      display: flex;
      justify-content: flex-end;
      margin-top: 15px;
      right: 50px;
      width: 250px;
      overflow: hidden;
    }

    .setting-slider {
      transition-duration: 0.3s;
    }
    
    .setting-slider.no-slide {
      transform: translateX(120%) scale(0);
    }
    
    .setting-slider.slide {
      transition-duration: 0.3s;
      transform: translateX(-120%) scale(1);
    }

    .change-button {
      top: 82.5%;
      position: absolute;
      flex: 1;
      margin-bottom: 175px;
      overflow: visible;
      transition-duration: 0.3s;
    }
    
    .change-button.no-slide:hover {
      color: var(--primary-color);
      transition-duration: 0.3s;
      transform: scale(1.2);
    }

    .unsavedSkinActionWrapper {
      position: absolute;
      display: flex;
      flex-direction: row;
      top: 82.5%;
      width: 50%;
      overflow: visible;
      justify-content: space-between;
    }

    .unsavedSkinActionWrapper h1 {
      transition-duration: 0.3s;
    }
    
    .unsavedSkinActionWrapper.no-slide h1:hover {
      transition-duration: 0.3s;
      transform: scale(1.2);
    }

    .cancel-button {
      color: red;
    }
    
    .save-button {
      color: green;
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
