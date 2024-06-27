<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { quintOut } from "svelte/easing";
  import { scale } from "svelte/transition";

  let microsoftOutput = "Please Sign in";

  onMount(async () => {
    const unlisten = await listen("microsoft-output", event => {
      microsoftOutput = event.payload;
    });

    return () => {
      unlisten();
    };
  });
</script>

<h1 class="branch-font shimmer" style="position:absolute"
    transition:scale={{ x: 15, duration: 300, easing: quintOut }}>{microsoftOutput}</h1>

<style>
    /* Shimmer animation credits to https://codepen.io/joshuapekera/pen/xGjMMq (https://codepen.io/joshuapekera) */
    /* TODO: Fix text blurriness (ChatGPT says its hard to fix) */
    .branch-font {
        font-family: 'Press Start 2P', serif;
        font-size: 18px;
        margin: 0;
        color: var(--primary-color);
        text-shadow: 2px 2px var(--primary-color-text-shadow);
        cursor: default;
    }

    .shimmer {
        text-align: center;
        color: rgba(255, 255, 255, 0.1);
        background: linear-gradient(90deg, #222 25%, #fff 50%, #222 75%);
        background-size: 300% 100%;
        -webkit-background-clip: text;
        -moz-background-clip: text;
        background-clip: text;
        -webkit-animation-name: shimmer;
        -moz-animation-name: shimmer;
        animation-name: shimmer;
        -webkit-animation-duration: 5s;
        -moz-animation-duration: 5s;
        animation-duration: 5s;
        -webkit-animation-iteration-count: infinite;
        -moz-animation-iteration-count: infinite;
        animation-iteration-count: infinite;
        background-repeat: no-repeat;
        background-position: 0 0;
        background-color: #222;
    }

    @-moz-keyframes shimmer {
        0% {
            background-position: 100% 0;
        }
        100% {
            background-position: -100% 0;
        }
    }

    @-webkit-keyframes shimmer {
        0% {
            background-position: 100% 0;
        }
        100% {
            background-position: -100% 0;
        }
    }

    @-o-keyframes shimmer {
        0% {
            background-position: 100% 0;
        }
        100% {
            background-position: -100% 0;
        }
    }

    @keyframes shimmer {
        0% {
            background-position: 100% 0;
        }
        100% {
            background-position: -100% 0;
        }
    }
</style>