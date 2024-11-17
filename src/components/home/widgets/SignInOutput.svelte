<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { quintOut } from "svelte/easing";
  import { scale } from "svelte/transition";
  import { translations } from '../../../utils/translationUtils.js';
    
  /** @type {{ [key: string]: any }} */
  $: lang = $translations;

  $: microsoftOutput = lang.signIn.signInText;
  let dots = "";
  let microsoftFlag = false;

  onMount(async () => {
    let interval;

    const unlisten = await listen("microsoft-output", event => {
      if (!microsoftFlag) {
        interval = animateLoadingText();
        microsoftFlag = true;
      }

      if (event.payload.includes('signIn.')) {
        let translatedStep = lang;
        event.payload.split('.').forEach(step => {
          translatedStep = translatedStep[step];
        });
        microsoftOutput = translatedStep;
      } else {
        microsoftOutput = event.payload;
      }
    });

    return () => {
      unlisten();
      clearInterval(interval);
    };
  });

  function animateLoadingText() {
    return setInterval(function() {
      dots += " .";
      if (dots.length > 6) {
        dots = "";
      }
    }, 500);
  }

</script>

<h1 class="branch-font primary-text" style="position:absolute"
    transition:scale={{ x: 15, duration: 300, easing: quintOut }}>{microsoftOutput}{dots}</h1>

<style>
    .branch-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        cursor: default;
    }
</style>
